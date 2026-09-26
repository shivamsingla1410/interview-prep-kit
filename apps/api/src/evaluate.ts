import dotenv from 'dotenv';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { generateKit } from './pipeline/generation.js';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const caseSchema = z.object({
  id: z.string().trim().min(1),
  jd: z.string().trim().min(1).max(30_000),
  company_url: z.string().trim().max(2048).url().refine((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }),
  days: z.number().int().min(1).max(60),
});

type BatchResult = {
  id: string;
  status: 'ok' | 'failed';
  kit: (Record<string, unknown> & { source_gaps: Array<{ source: string; reason: string }> }) | null;
  error: { code: string; message: string } | null;
};

function parseArgs(args: string[]) {
  let input: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag !== '--input' && flag !== '--output') throw new Error(`Unknown option: ${flag}`);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    if (flag === '--input') input = value;
    else output = value;
    index++;
  }
  if (!input || !output) throw new Error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
  // npm runs workspace scripts with the workspace directory as cwd. Keep the documented
  // paths rooted at the repository so the command behaves consistently from the repo root.
  const repositoryRoot = resolve(__dirname, '../../../');
  const inputPath = resolve(repositoryRoot, input);
  const outputPath = resolve(repositoryRoot, output);
  if (inputPath.toLowerCase() === outputPath.toLowerCase()) throw new Error('Input and output paths must be different.');
  return { inputPath, outputPath };
}

function caseId(value: unknown, index: number) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === 'string' && (value as Record<string, unknown>).id!.toString().trim()
    ? (value as Record<string, unknown>).id!.toString().trim()
    : `case-${index + 1}`;
}

function failure(code: string, message: string, id: string): BatchResult {
  return { id, status: 'failed', kit: null, error: { code, message } };
}

export async function evaluateCases(inputPath: string, outputPath: string) {
  const rawInput = await readFile(inputPath, 'utf8');
  let parsedInput: unknown;
  try { parsedInput = JSON.parse(rawInput.replace(/^\uFEFF/, '')); }
  catch { throw new Error(`Input file is not valid JSON: ${inputPath}`); }
  if (!Array.isArray(parsedInput)) throw new Error('Input JSON must be an array of cases.');

  const results: BatchResult[] = [];
  for (const [index, rawCase] of parsedInput.entries()) {
    const id = caseId(rawCase, index);
    const parsedCase = caseSchema.safeParse(rawCase);
    if (!parsedCase.success) {
      const issues = parsedCase.error.issues.map((issue) => `${issue.path.join('.') || 'case'}: ${issue.message}`).join('; ');
      results.push(failure('INVALID_CASE', issues, id));
      console.error(`[${index + 1}/${parsedInput.length}] ${id}: invalid case (${issues})`);
      continue;
    }

    const item = parsedCase.data;
    const title = item.jd.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 120) || 'Interview preparation';
    console.error(`[${index + 1}/${parsedInput.length}] ${id}: starting research and generation`);
    try {
      const { kit, sourceGaps } = await generateKit({
        title,
        companyUrl: item.company_url,
        jobDescription: item.jd,
        daysAvailable: item.days,
      }, (message) => console.error(`[${id}] ${message}`));
      results.push({
        id,
        status: 'ok',
        // Appendix A permits helpful extensions; preserve retrieval gaps so a partial-research
        // case remains successful while still being transparent to the evaluator.
        kit: { ...kit, source_gaps: sourceGaps },
        error: null,
      });
      console.error(`[${index + 1}/${parsedInput.length}] ${id}: complete`);
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown };
      const message = typeof candidate?.message === 'string' ? candidate.message : 'The pipeline could not produce a kit for this case.';
      const code = typeof candidate?.code === 'string' && candidate.code ? candidate.code : 'KIT_GENERATION_FAILED';
      results.push(failure(code, message, id));
      console.error(`[${index + 1}/${parsedInput.length}] ${id}: failed (${message})`);
    }
  }

  const document = { version: '1.0', generated_at: new Date().toISOString(), kits: results };
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
  console.error(`Wrote ${results.length} case result(s) to ${outputPath}`);
  return document;
}

async function main() {
  try {
    const { inputPath, outputPath } = parseArgs(process.argv.slice(2));
    await evaluateCases(inputPath, outputPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Batch evaluation failed.');
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
