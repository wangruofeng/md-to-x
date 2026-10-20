import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  entryPoints: ["src/sidepanel.js"],
  bundle: true,
  outdir: "dist",
  target: "chrome116",
  format: "esm",
});
await build({
  entryPoints: ["src/content.js"],
  bundle: true,
  outfile: "dist/content.js",
  target: "chrome116",
  format: "iife",
});
await build({
  entryPoints: ["src/table-main.js"],
  bundle: true,
  outfile: "dist/table-main.js",
  target: "chrome116",
  format: "iife",
});
await writeFile(
  "dist/sidepanel.html",
  (await readFile("index.html", "utf8"))
    .replace("/src/sidepanel.js", "./sidepanel.js")
    .replace(
      "</head>",
      '<link rel="stylesheet" href="./sidepanel.css"></head>',
    ),
);
console.log("扩展已生成：dist/");
