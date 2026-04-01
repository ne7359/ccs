import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSESSMENTS = {
  approved: '✅ APPROVED',
  approved_with_notes: '⚠️ APPROVED WITH NOTES',
  changes_requested: '❌ CHANGES REQUESTED',
};

const SEVERITY_ORDER = ['high', 'medium', 'low'];
const SEVERITY_HEADERS = {
  high: '### 🔴 High',
  medium: '### 🟡 Medium',
  low: '### 🟢 Low',
};

const STATUS_LABELS = {
  pass: '✅',
  fail: '⚠️',
  na: 'N/A',
};

const RENDERER_OWNED_MARKUP_PATTERNS = [
  { pattern: /^#{1,6}\s/u, reason: 'markdown heading' },
  { pattern: /^\s*Verdict\s*:/iu, reason: 'verdict label' },
  { pattern: /^\s*PR\s*#?\d+\s*Review(?:\s*[:.-]|$)/iu, reason: 'ad hoc PR heading' },
  { pattern: /\|\s*[-:]+\s*\|/u, reason: 'markdown table' },
  { pattern: /```/u, reason: 'code fence' },
];

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function escapeMarkdownText(value) {
  return cleanText(value).replace(/\\/g, '\\\\').replace(/([`*_{}[\]<>|])/g, '\\$1');
}

function renderCode(value) {
  const text = cleanText(value);
  const longestFence = Math.max(...[...text.matchAll(/`+/g)].map((match) => match[0].length), 0);
  const fence = '`'.repeat(longestFence + 1);
  return `${fence}${text}${fence}`;
}

function validatePlainTextField(fieldName, value) {
  const text = cleanText(value);
  if (!text) {
    return { ok: false, reason: `${fieldName} is required` };
  }

  const match = RENDERER_OWNED_MARKUP_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (match) {
    return { ok: false, reason: `${fieldName} contains ${match.reason}` };
  }

  return { ok: true, value: text };
}

function normalizeStringList(fieldName, raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: `${fieldName} must be an array` };
  }

  const values = [];
  for (const [index, item] of raw.entries()) {
    const validation = validatePlainTextField(`${fieldName}[${index}]`, item);
    if (!validation.ok) return validation;
    values.push(validation.value);
  }

  return { ok: true, value: values };
}

function normalizeChecklistRows(fieldName, labelField, raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: `${fieldName} must be an array` };
  }

  const rows = [];
  for (const [index, item] of raw.entries()) {
    const label = validatePlainTextField(`${fieldName}[${index}].${labelField}`, item?.[labelField]);
    if (!label.ok) return label;

    const notes = validatePlainTextField(`${fieldName}[${index}].notes`, item?.notes);
    if (!notes.ok) return notes;

    const status = cleanText(item?.status).toLowerCase();
    if (!STATUS_LABELS[status]) {
      return { ok: false, reason: `${fieldName}[${index}].status is invalid` };
    }

    rows.push({ [labelField]: label.value, status, notes: notes.value });
  }

  if (rows.length === 0) {
    return { ok: false, reason: `${fieldName} must contain at least 1 item` };
  }

  return { ok: true, value: rows };
}

function readExecutionMetadata(executionFile) {
  if (!executionFile || !fs.existsSync(executionFile)) {
    return {};
  }

  try {
    const turns = JSON.parse(fs.readFileSync(executionFile, 'utf8'));
    const init = turns.find((turn) => turn?.type === 'system' && turn?.subtype === 'init');
    const result = [...turns].reverse().find((turn) => turn?.type === 'result');
    return {
      runtimeTools: Array.isArray(init?.tools) ? init.tools : [],
      turnsUsed: typeof result?.num_turns === 'number' ? result.num_turns : null,
    };
  } catch {
    return {};
  }
}

export function normalizeStructuredOutput(raw) {
  if (!raw) {
    return { ok: false, reason: 'missing structured output' };
  }

  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, reason: 'structured output is not valid JSON' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'structured output must be an object' };
  }

  const summary = validatePlainTextField('summary', parsed.summary);
  if (!summary.ok) return summary;

  const overallAssessment = cleanText(parsed.overallAssessment).toLowerCase();
  const overallRationale = validatePlainTextField('overallRationale', parsed.overallRationale);
  if (!overallRationale.ok) return overallRationale;

  const findings = Array.isArray(parsed.findings) ? parsed.findings : null;
  const securityChecklist = normalizeChecklistRows('securityChecklist', 'check', parsed.securityChecklist);
  if (!securityChecklist.ok) return securityChecklist;

  const ccsCompliance = normalizeChecklistRows('ccsCompliance', 'rule', parsed.ccsCompliance);
  if (!ccsCompliance.ok) return ccsCompliance;

  const informational = normalizeStringList('informational', parsed.informational);
  if (!informational.ok) return informational;

  const strengths = normalizeStringList('strengths', parsed.strengths);
  if (!strengths.ok) return strengths;

  if (!ASSESSMENTS[overallAssessment] || findings === null) {
    return { ok: false, reason: 'structured output is missing required review fields' };
  }

  const normalizedFindings = [];
  for (const [index, finding] of findings.entries()) {
    const severity = cleanText(finding?.severity).toLowerCase();
    const title = validatePlainTextField(`findings[${index}].title`, finding?.title);
    if (!title.ok) return title;

    const file = validatePlainTextField(`findings[${index}].file`, finding?.file);
    if (!file.ok) return file;

    const what = validatePlainTextField(`findings[${index}].what`, finding?.what);
    if (!what.ok) return what;

    const why = validatePlainTextField(`findings[${index}].why`, finding?.why);
    if (!why.ok) return why;

    const fix = validatePlainTextField(`findings[${index}].fix`, finding?.fix);
    if (!fix.ok) return fix;

    let line = null;
    if (finding && Object.hasOwn(finding, 'line')) {
      if (finding.line === null) {
        line = null;
      } else if (typeof finding.line === 'number' && Number.isInteger(finding.line) && finding.line > 0) {
        line = finding.line;
      } else {
        return { ok: false, reason: `findings[${index}].line is invalid` };
      }
    }

    if (!SEVERITY_HEADERS[severity]) {
      return { ok: false, reason: `findings[${index}].severity is invalid` };
    }

    normalizedFindings.push({
      severity,
      title: title.value,
      file: file.value,
      line,
      what: what.value,
      why: why.value,
      fix: fix.value,
    });
  }

  return {
    ok: true,
    value: {
      summary: summary.value,
      findings: normalizedFindings,
      overallAssessment,
      overallRationale: overallRationale.value,
      securityChecklist: securityChecklist.value,
      ccsCompliance: ccsCompliance.value,
      informational: informational.value,
      strengths: strengths.value,
    },
  };
}

function renderChecklistTable(title, labelHeader, labelKey, rows) {
  const lines = ['', title, '', `| ${labelHeader} | Status | Notes |`, '|---|---|---|'];
  for (const row of rows) {
    lines.push(
      `| ${escapeMarkdownText(row[labelKey])} | ${STATUS_LABELS[row.status]} | ${escapeMarkdownText(row.notes)} |`
    );
  }
  return lines;
}

function renderBulletSection(title, items) {
  if (items.length === 0) return [];
  return ['', title, ...items.map((item) => `- ${escapeMarkdownText(item)}`)];
}

export function renderStructuredReview(review, { model }) {
  const lines = ['### 📋 Summary', '', escapeMarkdownText(review.summary), '', '### 🔍 Findings'];

  if (review.findings.length === 0) {
    lines.push('No confirmed issues found after reviewing the diff and surrounding code.');
  } else {
    for (const severity of SEVERITY_ORDER) {
      const findings = review.findings.filter((finding) => finding.severity === severity);
      if (findings.length === 0) continue;

      lines.push('', SEVERITY_HEADERS[severity], '');
      for (const finding of findings) {
        const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
        lines.push(`- **${renderCode(location)} — ${escapeMarkdownText(finding.title)}**`);
        lines.push(`  Problem: ${escapeMarkdownText(finding.what)}`);
        lines.push(`  Why it matters: ${escapeMarkdownText(finding.why)}`);
        lines.push(`  Suggested fix: ${escapeMarkdownText(finding.fix)}`);
        lines.push('');
      }
    }
    if (lines[lines.length - 1] === '') lines.pop();
  }

  lines.push(...renderChecklistTable('### 🔒 Security Checklist', 'Check', 'check', review.securityChecklist));
  lines.push(...renderChecklistTable('### 📊 CCS Compliance', 'Rule', 'rule', review.ccsCompliance));
  lines.push(...renderBulletSection('### 💡 Informational', review.informational));
  lines.push(...renderBulletSection("### ✅ What's Done Well", review.strengths));

  lines.push(
    '',
    '### 🎯 Overall Assessment',
    '',
    `**${ASSESSMENTS[review.overallAssessment]}** — ${escapeMarkdownText(review.overallRationale)}`,
    '',
    `> 🤖 Reviewed by \`${model}\``
  );

  return lines.join('\n');
}

export function renderIncompleteReview({ model, reason, runUrl, runtimeTools, turnsUsed }) {
  const lines = [
    '### ⚠️ AI Review Incomplete',
    '',
    'Claude did not return validated structured review output, so this workflow did not publish raw scratch text.',
    '',
    `- Reason: ${escapeMarkdownText(reason)}`,
  ];

  if (runtimeTools?.length) {
    lines.push(`- Runtime tools: ${runtimeTools.map(renderCode).join(', ')}`);
  }
  if (typeof turnsUsed === 'number') {
    lines.push(`- Turns used: ${turnsUsed}`);
  }

  lines.push('', `Re-run \`/review\` or inspect [the workflow run](${runUrl}).`, '', `> 🤖 Reviewed by \`${model}\``);
  return lines.join('\n');
}

export function writeReviewFromEnv(env = process.env) {
  const outputFile = env.AI_REVIEW_OUTPUT_FILE || 'pr_review.md';
  const model = env.AI_REVIEW_MODEL || 'unknown-model';
  const runUrl = env.AI_REVIEW_RUN_URL || '#';
  const validation = normalizeStructuredOutput(env.AI_REVIEW_STRUCTURED_OUTPUT);
  const metadata = readExecutionMetadata(env.AI_REVIEW_EXECUTION_FILE);
  const content = validation.ok
    ? renderStructuredReview(validation.value, { model })
    : renderIncompleteReview({
        model,
        reason: validation.reason,
        runUrl,
        runtimeTools: metadata.runtimeTools,
        turnsUsed: metadata.turnsUsed,
      });

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${content}\n`, 'utf8');

  if (!validation.ok) {
    console.warn(`::warning::AI review output normalization fell back to incomplete comment: ${validation.reason}`);
  }

  return { usedFallback: !validation.ok, content };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  writeReviewFromEnv();
}
