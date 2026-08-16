import { copyFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

function getVaultPath() {
	const env = process.env.OBSIDIAN_VAULT;
	if (env) return env.trim();
	const localFile = join(dirname(fileURLToPath(import.meta.url)), ".vault-path");
	if (existsSync(localFile)) {
		return readFileSync(localFile, "utf8").trim();
	}
	console.error(
		"Error: vault path not configured.\n" +
		"Either create a .vault-path file with the path to your Obsidian vault root,\n" +
		"or set the OBSIDIAN_VAULT environment variable."
	);
	process.exit(1);
}

const vault = getVaultPath();
const dest = join(vault, ".obsidian", "plugins", "obsidian-agent-ogent");
mkdirSync(dest, { recursive: true });

for (const file of ["main.js", "styles.css", "manifest.json"]) {
	copyFileSync(file, join(dest, file));
	console.log(`  copied ${file} → ${dest}/`);
}
