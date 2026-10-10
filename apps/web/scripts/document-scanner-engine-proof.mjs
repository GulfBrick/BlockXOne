import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CLAMAV_EXECUTABLE,
  CLAMAV_EXECUTABLE_SHA256,
  CLAMAV_VERSION,
  scanWithClamav,
} from './document-scanner-runner.mjs';

const PACKAGE_SHA256 = 'd3ee9e401974855a1edc1761b1425417d126de618d5f0c91cd51209f69f6fcc2';
const CLOUD_PROOF_ID = 'github-clamav-1.4.6';
const TEMP_PREFIX = 'bx1-scanner-engine-proof-';
const DETECTION_MARKER = 'BX1-HARMLESS-CLAMAV-CUSTOM-SIGNATURE-20261011';
const SIGNATURE_NAME = 'Test.Bx1EngineProofPdf';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertCloudProofEnvironment() {
  assert.equal(process.platform, 'linux', 'Cloud engine proof requires Linux.');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Cloud engine proof requires GitHub Actions.');
  assert.equal(process.env.BX1_SCANNER_CLOUD_PROOF, CLOUD_PROOF_ID, 'Cloud engine proof identity mismatch.');
  assert.equal(process.env.BX1_SCANNER_CLOUD_ENGINE, '/usr/local/bin/clamscan', 'Cloud engine path mismatch.');
  assert.equal(process.env.BX1_SCANNER_PACKAGE_SHA256, PACKAGE_SHA256, 'Cloud engine package identity mismatch.');
  assert.equal(CLAMAV_EXECUTABLE, '/usr/local/bin/clamscan', 'Runner engine path mismatch.');
  assert.equal(CLAMAV_VERSION, '1.4.6', 'Runner engine version mismatch.');
}

// Valid, unencrypted, uncompressed one-page PDF; the document never becomes a file.
function makePdf(text) {
  assert.match(text, /^[A-Za-z0-9 _-]+$/);
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

function assertScanReceipt(result, verdict, bytes, databaseSha256) {
  assert.equal(result.verdict, verdict, 'Unexpected real engine verdict.');
  assert.equal(result.engineVersion, CLAMAV_VERSION, 'Real engine version mismatch.');
  assert.equal(result.engineSha256, CLAMAV_EXECUTABLE_SHA256, 'Real engine executable identity mismatch.');
  assert.equal(result.databaseSha256, databaseSha256, 'Real engine database identity mismatch.');
  assert.equal(result.sha256, sha256(bytes), 'Real engine document identity mismatch.');
}

export async function runCloudEngineProof() {
  // These are an execution guard, not a claim that environment values attest the package.
  // CI separately verifies its pinned package hash before this proof can run.
  assertCloudProofEnvironment();
  const benignPdf = makePdf('BlockXOne harmless clean scanner fixture');
  const detectionPdf = makePdf(DETECTION_MARKER);
  assert.equal(benignPdf.includes(Buffer.from(DETECTION_MARKER, 'ascii')), false);
  assert.equal(detectionPdf.includes(Buffer.from(DETECTION_MARKER, 'ascii')), true);
  assert.notEqual(sha256(benignPdf), sha256(detectionPdf));

  // ClamAV .ndb extended signature: name:target type:any offset:hex content.
  // Target 0 matches the literal harmless marker; no official signatures are loaded.
  const signatureBytes = Buffer.from(
    `${SIGNATURE_NAME}:0:*:${Buffer.from(DETECTION_MARKER, 'ascii').toString('hex')}\n`,
    'ascii',
  );
  const databaseSha256 = sha256(signatureBytes);
  const temporaryRoot = resolve(tmpdir());
  const privateDirectory = resolve(await mkdtemp(join(temporaryRoot, TEMP_PREFIX)));
  // Bound cleanup to the exact directory created for this invocation.
  assert.equal(dirname(privateDirectory), temporaryRoot);
  assert.equal(basename(privateDirectory).startsWith(TEMP_PREFIX), true);
  try {
    await chmod(privateDirectory, 0o700);
    assert.equal((await stat(privateDirectory)).mode & 0o777, 0o700, 'Proof directory is not private.');
    const databasePath = join(privateDirectory, 'fixture-only.ndb');
    await writeFile(databasePath, signatureBytes, { flag: 'wx', mode: 0o600 });
    await chmod(databasePath, 0o600);
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600, 'Proof database is not private.');
    assert.equal(sha256(await readFile(databasePath)), databaseSha256, 'Written proof database identity mismatch.');

    // No spawn override: both calls must use the runner's real pinned subprocess path.
    const benign = await scanWithClamav(benignPdf, { databasePath, databaseSha256 });
    assertScanReceipt(benign, 'CLEAN', benignPdf, databaseSha256);
    const detected = await scanWithClamav(detectionPdf, { databasePath, databaseSha256 });
    assertScanReceipt(detected, 'MALICIOUS', detectionPdf, databaseSha256);

    return {
      ok: true,
      proof: 'REAL_CLAMAV_CUSTOM_FIXTURE_ENGINE',
      engineVersion: CLAMAV_VERSION,
      executableSha256: CLAMAV_EXECUTABLE_SHA256,
      packageSha256: PACKAGE_SHA256,
      databaseSha256,
      signatureDatabase: 'CUSTOM_HARMLESS_FIXTURE_ONLY',
      productionMalwareCoverageProved: false,
      hostedWorkerAcceptanceProved: false,
      benign: { mimeType: 'application/pdf', verdict: benign.verdict, sha256: benign.sha256 },
      detected: { mimeType: 'application/pdf', verdict: detected.verdict, sha256: detected.sha256 },
    };
  } finally {
    await rm(privateDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCloudEngineProof().then(
    (receipt) => { console.log(JSON.stringify(receipt)); },
    () => {
      // Never expose engine output, filesystem paths, document bytes or exception details.
      console.error(JSON.stringify({ ok: false, proof: 'REAL_CLAMAV_CUSTOM_FIXTURE_ENGINE', code: 'ENGINE_PROOF_FAILED' }));
      process.exitCode = 1;
    },
  );
}
