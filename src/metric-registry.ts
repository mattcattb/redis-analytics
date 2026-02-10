import type { TSConfig, TSFilter } from "./redis/timeseries.service";
import {
  DimensionalTSStore,
  type DimensionalTSPoint,
  type DimensionDef,
} from "./store/store.dimentional-ts";

type StringTuple = readonly string[];

export type MetricDimension<
  TName extends string,
  TValues extends StringTuple = StringTuple,
> = {
  name: TName;
  values: TValues;
};

type MetricDimensions = readonly MetricDimension<string, StringTuple>[];

type DimensionName<TDims extends MetricDimensions> = TDims[number]["name"];

type DimensionValue<
  TDims extends MetricDimensions,
  TName extends string,
> = Extract<TDims[number], { name: TName }> extends MetricDimension<any, infer TValues>
  ? TValues[number]
  : never;

export type MetricDimensionValues<TDims extends MetricDimensions> = {
  [K in DimensionName<TDims>]: DimensionValue<TDims, K>;
};

export type MetricDimensionFilter<TDims extends MetricDimensions> = Partial<{
  [K in DimensionName<TDims>]:
    | DimensionValue<TDims, K>
    | readonly DimensionValue<TDims, K>[];
}>;

export type DimensionalMetricDefinition<TDims extends MetricDimensions> = {
  prefix: string;
  suffix: string;
  dimensions: TDims;
  config?: TSConfig;
  staticLabels?: Record<string, string>;
};

type MetricKey = string;

function assertNoUnsafeValue(input: string, field: string): void {
  if (!input.length) {
    throw new Error(`Invalid empty ${field}`);
  }
  if (input.includes("=")) {
    throw new Error(`Invalid ${field}. "=" is not allowed: ${input}`);
  }
}

function toStringRecord(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [String(k), String(v)])
  );
}

export function createDimensionalMetric<const TDims extends MetricDimensions>(
  definition: DimensionalMetricDefinition<TDims>
) {
  const baseKey = `${definition.prefix}:${definition.suffix}`;
  const dimNames = definition.dimensions.map((d) => d.name);
  const knownValuesByDim = new Map<string, Set<string>>(
    definition.dimensions.map((d) => [d.name, new Set(d.values)])
  );
  const staticLabels = toStringRecord(definition.staticLabels ?? {});
  const dimDefs = definition.dimensions.map(
    (d) =>
      ({
        name: d.name,
        knownValues: d.values,
      }) satisfies DimensionDef<string>
  ) as DimensionDef<DimensionName<TDims> & string>[];

  assertNoUnsafeValue(definition.prefix, "prefix");
  assertNoUnsafeValue(definition.suffix, "suffix");
  for (const dim of definition.dimensions) {
    assertNoUnsafeValue(dim.name, "dimension name");
    for (const value of dim.values) {
      assertNoUnsafeValue(value, `dimension value for ${dim.name}`);
    }
  }
  for (const [label, value] of Object.entries(staticLabels)) {
    assertNoUnsafeValue(label, "static label name");
    assertNoUnsafeValue(value, "static label value");
  }

  const assertDimensions = (
    dimensions: Record<string, string>,
    options: { partial: boolean }
  ) => {
    for (const key of Object.keys(dimensions)) {
      if (!knownValuesByDim.has(key)) {
        throw new Error(
          `Unknown dimension "${key}" for metric "${baseKey}". Known dimensions: ${dimNames.join(", ")}`
        );
      }
    }

    if (!options.partial) {
      for (const name of dimNames) {
        if (!dimensions[name]) {
          throw new Error(`Missing dimension "${name}" for metric "${baseKey}"`);
        }
      }
    }

    for (const [name, rawValue] of Object.entries(dimensions)) {
      assertNoUnsafeValue(rawValue, `dimension value for ${name}`);
      const knownValues = knownValuesByDim.get(name)!;
      if (!knownValues.has(rawValue)) {
        throw new Error(
          `Invalid value "${rawValue}" for dimension "${name}" in metric "${baseKey}"`
        );
      }
    }
  };

  const normalizeDims = (
    dims: MetricDimensionValues<TDims>
  ): Record<DimensionName<TDims> & string, string> =>
    Object.fromEntries(
      Object.entries(dims).map(([key, value]) => [key, String(value)])
    ) as Record<DimensionName<TDims> & string, string>;

  return {
    baseKey,
    dimensions: definition.dimensions,
    createStore() {
      return new DimensionalTSStore<DimensionName<TDims> & string>(
        baseKey,
        dimDefs,
        definition.config
      );
    },
    key(dimensions: MetricDimensionValues<TDims>): MetricKey {
      const normalized = normalizeDims(dimensions);
      assertDimensions(normalized, { partial: false });
      const suffix = dimNames
        .map((name) => {
          const dimName = name as DimensionName<TDims> & string;
          return `${dimName}=${normalized[dimName]}`;
        })
        .join(":");
      return `${baseKey}:${suffix}`;
    },
    labels(dimensions: MetricDimensionValues<TDims>): Record<string, string> {
      const normalized = normalizeDims(dimensions);
      assertDimensions(normalized, { partial: false });
      return { baseKey, ...staticLabels, ...normalized };
    },
    point(input: {
      timestamp: Date;
      value: number;
      dimensions: MetricDimensionValues<TDims>;
    }): DimensionalTSPoint<DimensionName<TDims> & string> {
      const normalized = normalizeDims(input.dimensions);
      assertDimensions(normalized, { partial: false });
      return {
        timestamp: input.timestamp,
        value: input.value,
        dimensions: normalized,
      };
    },
    points(
      inputs: Array<{
        timestamp: Date;
        value: number;
        dimensions: MetricDimensionValues<TDims>;
      }>
    ): DimensionalTSPoint<DimensionName<TDims> & string>[] {
      return inputs.map((input) => this.point(input));
    },
    filter(dimensions?: MetricDimensionFilter<TDims>): TSFilter {
      const filter: TSFilter = { baseKey, ...staticLabels };
      if (!dimensions) return filter;

      for (const [name, value] of Object.entries(dimensions)) {
        if (value === undefined) continue;
        if (!knownValuesByDim.has(name)) {
          throw new Error(
            `Unknown filter dimension "${name}" for metric "${baseKey}". Known dimensions: ${dimNames.join(", ")}`
          );
        }

        if (Array.isArray(value)) {
          const normalized = value.map((v) => String(v));
          assertDimensions({ [name]: normalized[0] ?? "" }, { partial: true });
          for (const item of normalized) {
            assertDimensions({ [name]: item }, { partial: true });
          }
          filter[name] = normalized;
          continue;
        }

        const normalized = String(value);
        assertDimensions({ [name]: normalized }, { partial: true });
        filter[name] = normalized;
      }

      return filter;
    },
  };
}

export function mapMetricConfig<TMetric extends string, TConfig, TResult>(
  config: Record<TMetric, TConfig>,
  create: (cfg: TConfig, metric: TMetric) => TResult
): Record<TMetric, TResult> {
  return Object.fromEntries(
    Object.entries(config).map(([metric, cfg]) => [
      metric,
      create(cfg as TConfig, metric as TMetric),
    ])
  ) as Record<TMetric, TResult>;
}
