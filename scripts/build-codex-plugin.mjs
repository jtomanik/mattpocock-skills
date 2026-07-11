#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const sourceManifestPath = path.join(root, ".claude-plugin", "plugin.json");
const pluginRoot = path.join(root, "plugins", "matt-pocock-skills");
const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const generatedSkillsRoot = path.join(pluginRoot, "skills");
const version = process.argv[2];

if (!version) {
  throw new Error("Usage: node scripts/build-codex-plugin.mjs <plugin-version>");
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const sourceSkills = sourceManifest.skills;

if (!Array.isArray(sourceSkills) || sourceSkills.length === 0) {
  throw new Error(`${sourceManifestPath} has no skill directories`);
}

const destinations = new Set();
await rm(generatedSkillsRoot, { recursive: true, force: true });
await mkdir(generatedSkillsRoot, { recursive: true });

for (const configuredPath of sourceSkills) {
  const sourceDir = path.resolve(root, configuredPath);
  const skillName = path.basename(sourceDir);
  const destinationDir = path.join(generatedSkillsRoot, skillName);

  if (destinations.has(skillName)) {
    throw new Error(`Duplicate packaged skill name: ${skillName}`);
  }
  destinations.add(skillName);

  await cp(sourceDir, destinationDir, { recursive: true, preserveTimestamps: true });

  const skillPath = path.join(destinationDir, "SKILL.md");
  const source = await readFile(skillPath, "utf8");
  const lines = source.split("\n");
  const closingFence = lines.indexOf("---", 1);

  if (lines[0] !== "---" || closingFence < 0) {
    throw new Error(`${skillPath} has invalid frontmatter`);
  }

  const frontmatter = lines.slice(1, closingFence);
  const explicitOnly = frontmatter.some((line) =>
    /^disable-model-invocation:\s*true\s*$/.test(line),
  );
  const codexFrontmatter = frontmatter.filter(
    (line) =>
      !/^disable-model-invocation:/.test(line) &&
      !/^argument-hint:/.test(line),
  );

  await writeFile(
    skillPath,
    ["---", ...codexFrontmatter, "---", ...lines.slice(closingFence + 1)].join("\n"),
  );

  if (explicitOnly) {
    const metadataDir = path.join(destinationDir, "agents");
    await mkdir(metadataDir, { recursive: true });
    await writeFile(
      path.join(metadataDir, "openai.yaml"),
      "policy:\n  allow_implicit_invocation: false\n",
    );
  }
}

const pluginManifest = JSON.parse(await readFile(pluginManifestPath, "utf8"));
pluginManifest.version = version;
await writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`);

console.log(`Packaged ${sourceSkills.length} skills as ${version}.`);
