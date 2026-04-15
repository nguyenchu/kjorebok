#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appJsonPath = resolve(root, "apps/mobile/app.json");

const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
const current = appJson.expo.version;
const [major, minor, patch] = current.split(".").map(Number);
const next = `${major}.${minor}.${patch + 1}`;

appJson.expo.version = next;
writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + "\n");

execSync(`git add ${appJsonPath}`, { stdio: "inherit" });
execSync(`git commit -m "Bump mobile version to ${next}"`, { stdio: "inherit" });

console.log(`${current} → ${next}`);
