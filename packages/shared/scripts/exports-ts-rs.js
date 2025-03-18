import fs from "fs";

export const generateIndexTs = () => {
  const dir = import.meta.dirname;
  const exports = fs.readdirSync(dir + "/../src/types");

  const exportsLines = exports.map((file) => {
    return `export * from "./types/${file.replace(".ts", "")}";`;
  });

  fs.writeFileSync(dir + "/../src/index.ts", [...exportsLines].join("\n"));
};

export const main = () => {
  generateIndexTs();
};

main();
