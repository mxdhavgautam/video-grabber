import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const fixtureDir = join(process.cwd(), "fixtures", "extractor");
const files = (await readdir(fixtureDir)).filter((entry) => entry.endsWith(".json"));

if (!files.length) {
  console.error("No extractor fixtures found.");
  process.exit(1);
}

let checked = 0;

for (const fileName of files) {
  const raw = await readFile(join(fixtureDir, fileName), "utf8");
  const fixture = JSON.parse(raw);

  if (!fixture?.name || !fixture?.input || !fixture?.expected) {
    throw new Error(`Fixture ${fileName} is missing required top-level fields.`);
  }

  const adaptiveFormats = fixture.input.adaptiveFormats;
  if (!Array.isArray(adaptiveFormats) || adaptiveFormats.length === 0) {
    throw new Error(`Fixture ${fileName} must include at least one adaptive format.`);
  }

  const qualitySet = new Set(
    adaptiveFormats
      .map((format) => format.quality_label)
      .filter((label) => typeof label === "string" && label.length > 0)
  );

  const expectedQualityLabels = fixture.expected.requiresQualityLabels ?? [];
  for (const label of expectedQualityLabels) {
    if (!qualitySet.has(label)) {
      throw new Error(`Fixture ${fileName} expected missing quality label: ${label}`);
    }
  }

  checked += 1;
}

console.log(`Extractor fixture checks passed (${checked} fixtures).`);
