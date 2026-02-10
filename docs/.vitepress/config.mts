import { defineConfig } from "vitepress";

export default defineConfig({
  title: "redis-analytics",
  description: "Reusable Redis analytics primitives for TS/HLL/Bloom-backed metrics",
  base: "/redis-analytics/",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "API", link: "/api/reference" },
      { text: "GitHub", link: "https://github.com/mattcattb/redis-analytics" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "Integration", link: "/integration" },
        ],
      },
      {
        text: "Usage",
        items: [
          { text: "TimeSeries", link: "/usage/timeseries" },
          { text: "HLL and Bloom", link: "/usage/hll-and-bloom" },
          { text: "Queries", link: "/usage/queries" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "API Surface", link: "/api/reference" },
          { text: "Roadmap", link: "/roadmap" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/mattcattb/redis-analytics" },
    ],
  },
});
