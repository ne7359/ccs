import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const reviewOutput = await import('../../../../scripts/github/normalize-ai-review-output.mjs');

function withTempDir(prefix: string, run: (tempDir: string) => void) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    run(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('normalize-ai-review-output', () => {
  test('renders validated structured output into stable markdown', () => {
    const validation = reviewOutput.normalizeStructuredOutput(
      JSON.stringify({
        summary: 'The PR is mostly correct, but one blocking regression remains.',
        findings: [
          {
            severity: 'high',
            title: 'Ambiguous account lookup drops valid matches',
            file: 'src/cliproxy/accounts/query.ts',
            line: 61,
            what: 'Exact email matches can return null when duplicate accounts exist.',
            why: 'That breaks normal selection flows for users with multiple Codex sessions.',
            fix: 'Match by stable account identity first and keep ambiguous email lookups out of exact-match paths.',
          },
        ],
        securityChecklist: [
          {
            check: 'Injection safety',
            status: 'pass',
            notes: 'No user-controlled input reaches a shell, SQL, or HTML boundary in this diff.',
          },
        ],
        ccsCompliance: [
          {
            rule: 'No emojis in CLI',
            status: 'na',
            notes: 'This change affects GitHub PR comments only, not CLI stdout.',
          },
        ],
        informational: ['The renderer still escapes markdown before publishing comment content.'],
        strengths: ['The formatter owns the output shape instead of trusting the model to author markdown.'],
        overallAssessment: 'changes_requested',
        overallRationale: 'The blocking lookup regression should be fixed before merge.',
      })
    );

    expect(validation.ok).toBe(true);
    const markdown = reviewOutput.renderStructuredReview(validation.value, { model: 'glm-5.1' });

    expect(markdown).toContain('### 📋 Summary');
    expect(markdown).toContain('### 🔴 High');
    expect(markdown).toContain('**`src/cliproxy/accounts/query.ts:61` — Ambiguous account lookup drops valid matches**');
    expect(markdown).toContain('### 🔒 Security Checklist');
    expect(markdown).toContain('| Injection safety | ✅ | No user-controlled input reaches a shell, SQL, or HTML boundary in this diff. |');
    expect(markdown).toContain('### 📊 CCS Compliance');
    expect(markdown).toContain('| No emojis in CLI | N/A | This change affects GitHub PR comments only, not CLI stdout. |');
    expect(markdown).toContain('### 💡 Informational');
    expect(markdown).toContain('### ✅ What\'s Done Well');
    expect(markdown).toContain('### 🎯 Overall Assessment');
    expect(markdown).toContain('**❌ CHANGES REQUESTED**');
    expect(markdown).toContain('Why it matters: That breaks normal selection flows for users with multiple Codex sessions.');
    expect(markdown).toContain('> 🤖 Reviewed by `glm-5.1`');
  });

  test('writes a safe incomplete comment instead of leaking raw assistant text', () => {
    withTempDir('ai-review-', (tempDir) => {
      const executionFile = path.join(tempDir, 'claude-execution-output.json');
      const outputFile = path.join(tempDir, 'pr_review.md');

      fs.writeFileSync(
        executionFile,
        JSON.stringify([
          { type: 'system', subtype: 'init', tools: ['Bash', 'Edit', 'Read'] },
          {
            type: 'result',
            subtype: 'success',
            num_turns: 25,
            result: 'Now let me verify the findings before I finalize the review...',
          },
        ])
      );

      const result = reviewOutput.writeReviewFromEnv({
        AI_REVIEW_EXECUTION_FILE: executionFile,
        AI_REVIEW_MODEL: 'glm-5.1',
        AI_REVIEW_OUTPUT_FILE: outputFile,
        AI_REVIEW_RUN_URL: 'https://github.com/kaitranntt/ccs/actions/runs/23758377592',
        AI_REVIEW_STRUCTURED_OUTPUT: '',
      });

      expect(result.usedFallback).toBe(true);

      const markdown = fs.readFileSync(outputFile, 'utf8');
      expect(markdown).toContain('### ⚠️ AI Review Incomplete');
      expect(markdown).toContain('Runtime tools: `Bash`, `Edit`, `Read`');
      expect(markdown).toContain('Turns used: 25');
      expect(markdown).not.toContain('Now let me verify the findings');
    });
  });

  test('escapes markdown-looking content and ignores malformed execution metadata', () => {
    withTempDir('ai-review-', (tempDir) => {
      const executionFile = path.join(tempDir, 'claude-execution-output.json');
      const outputFile = path.join(tempDir, 'pr_review.md');

      fs.writeFileSync(executionFile, '{not valid json');

      const result = reviewOutput.writeReviewFromEnv({
        AI_REVIEW_EXECUTION_FILE: executionFile,
        AI_REVIEW_MODEL: 'glm-5.1',
        AI_REVIEW_OUTPUT_FILE: outputFile,
        AI_REVIEW_RUN_URL: 'https://github.com/kaitranntt/ccs/actions/runs/1',
        AI_REVIEW_STRUCTURED_OUTPUT: JSON.stringify({
          summary: 'Summary with `code` and ## heading markers.',
          findings: [
            {
              severity: 'low',
              title: 'Title with `ticks`',
              file: 'src/example.ts',
              line: 9,
              what: 'Problem text uses **bold** markers.',
              why: 'Why text uses [link] syntax.',
              fix: 'Fix text uses <html> markers.',
            },
          ],
          securityChecklist: [
            {
              check: 'Injection safety',
              status: 'pass',
              notes: 'Notes with a pipe | still render safely in table cells.',
            },
          ],
          ccsCompliance: [
            {
              rule: 'Cross-platform',
              status: 'pass',
              notes: 'Applies equally across macOS, Linux, and Windows.',
            },
          ],
          informational: ['Informational item with `inline code`.'],
          strengths: ['Strength with **bold** markers.'],
          overallAssessment: 'approved_with_notes',
          overallRationale: 'Rationale keeps `_formatting_` stable.',
        }),
      });

      expect(result.usedFallback).toBe(false);

      const markdown = fs.readFileSync(outputFile, 'utf8');
      expect(markdown).toContain('Summary with \\`code\\` and ## heading markers.');
      expect(markdown).toContain('**`src/example.ts:9` — Title with \\`ticks\\`**');
      expect(markdown).toContain('Problem: Problem text uses \\*\\*bold\\*\\* markers.');
      expect(markdown).toContain('Why it matters: Why text uses \\[link\\] syntax.');
      expect(markdown).toContain('Suggested fix: Fix text uses \\<html\\> markers.');
      expect(markdown).toContain('Notes with a pipe \\| still render safely in table cells.');
      expect(markdown).toContain('- Informational item with \\`inline code\\`.');
      expect(markdown).toContain('- Strength with \\*\\*bold\\*\\* markers.');
      expect(markdown).toContain('**⚠️ APPROVED WITH NOTES** — Rationale keeps \\`\\_formatting\\_\\` stable.');
    });
  });

  test('rejects ad hoc layout markup inside structured fields', () => {
    const validation = reviewOutput.normalizeStructuredOutput(
      JSON.stringify({
        summary: '# PR #860 Review',
        findings: [],
        securityChecklist: [{ check: 'Injection safety', status: 'pass', notes: 'Covered.' }],
        ccsCompliance: [{ rule: 'ASCII-only CLI output', status: 'pass', notes: 'Unaffected.' }],
        informational: [],
        strengths: [],
        overallAssessment: 'approved_with_notes',
        overallRationale: 'The review is otherwise valid.',
      })
    );

    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain('summary contains');
  });

  test('renders approved reviews with substantive checklist rows when optional arrays are empty', () => {
    const validation = reviewOutput.normalizeStructuredOutput(
      JSON.stringify({
        summary: 'The diff is ready to merge as-is.',
        findings: [],
        securityChecklist: [
          {
            check: 'Injection safety',
            status: 'pass',
            notes: 'No user-controlled data crosses a risky boundary in the reviewed diff.',
          },
        ],
        ccsCompliance: [
          {
            rule: 'Help/docs alignment',
            status: 'na',
            notes: 'No CLI behavior changed, so there was nothing to update.',
          },
        ],
        informational: [],
        strengths: [],
        overallAssessment: 'approved',
        overallRationale: 'No confirmed regressions or missing verification remain.',
      })
    );

    expect(validation.ok).toBe(true);
    const markdown = reviewOutput.renderStructuredReview(validation.value, { model: 'glm-5.1' });

    expect(markdown).toContain('### 🔍 Findings');
    expect(markdown).toContain('No confirmed issues found after reviewing the diff and surrounding code.');
    expect(markdown).toContain('### 🔒 Security Checklist');
    expect(markdown).toContain(
      '| Injection safety | ✅ | No user-controlled data crosses a risky boundary in the reviewed diff. |'
    );
    expect(markdown).toContain('### 📊 CCS Compliance');
    expect(markdown).toContain('| Help/docs alignment | N/A | No CLI behavior changed, so there was nothing to update. |');
    expect(markdown).toContain('**✅ APPROVED** — No confirmed regressions or missing verification remain.');
  });

  test('renders findings without line numbers using the file path only', () => {
    const validation = reviewOutput.normalizeStructuredOutput(
      JSON.stringify({
        summary: 'One follow-up remains.',
        findings: [
          {
            severity: 'medium',
            title: 'Missing empty-state coverage',
            file: 'tests/unit/scripts/github/normalize-ai-review-output.test.ts',
            line: null,
            what: 'The empty-findings branch is not covered by a regression test.',
            why: 'That leaves the highest-frequency render path vulnerable to silent regressions.',
            fix: 'Add a test that passes an approved review with an empty findings array.',
          },
        ],
        securityChecklist: [{ check: 'Injection safety', status: 'pass', notes: 'Covered.' }],
        ccsCompliance: [{ rule: 'ASCII-only CLI output', status: 'pass', notes: 'Unaffected.' }],
        informational: [],
        strengths: [],
        overallAssessment: 'approved_with_notes',
        overallRationale: 'The remaining gap is test coverage only.',
      })
    );

    expect(validation.ok).toBe(true);
    const markdown = reviewOutput.renderStructuredReview(validation.value, { model: 'glm-5.1' });

    expect(markdown).toContain(
      '**`tests/unit/scripts/github/normalize-ai-review-output.test.ts` — Missing empty-state coverage**'
    );
    expect(markdown).not.toContain('normalize-ai-review-output.test.ts:`');
  });

  test('renders inline code safely when the location includes backticks', () => {
    const markdown = reviewOutput.renderStructuredReview(
      {
        summary: 'Rendering stays stable.',
        findings: [
          {
            severity: 'low',
            title: 'Backtick-safe locations stay readable',
            file: 'src/weird`path.ts',
            line: null,
            what: 'Location formatting needs a longer fence when input contains backticks.',
            why: 'Otherwise GitHub markdown can break the inline code span.',
            fix: 'Pick a fence one tick longer than the longest run in the input.',
          },
        ],
        securityChecklist: [{ check: 'Injection safety', status: 'pass', notes: 'Covered.' }],
        ccsCompliance: [{ rule: 'ASCII-only CLI output', status: 'pass', notes: 'Unaffected.' }],
        informational: [],
        strengths: [],
        overallAssessment: 'approved_with_notes',
        overallRationale: 'This is a formatting-only follow-up.',
      },
      { model: 'glm-5.1' }
    );

    expect(markdown).toContain('**``src/weird`path.ts`` — Backtick-safe locations stay readable**');
  });

  test('rejects empty checklist sections instead of synthesizing placeholder rows', () => {
    const validation = reviewOutput.normalizeStructuredOutput(
      JSON.stringify({
        summary: 'The diff is ready to merge as-is.',
        findings: [],
        securityChecklist: [],
        ccsCompliance: [],
        informational: [],
        strengths: [],
        overallAssessment: 'approved',
        overallRationale: 'No confirmed regressions remain.',
      })
    );

    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain('securityChecklist must contain at least 1 item');
  });

  test('allows plain prose that references section labels without starting with them', () => {
    const validation = reviewOutput.normalizeStructuredOutput(
      JSON.stringify({
        summary: 'The Security Checklist: row is now required, but the prose summary remains valid.',
        findings: [],
        securityChecklist: [{ check: 'Injection safety', status: 'pass', notes: 'Covered.' }],
        ccsCompliance: [{ rule: 'ASCII-only CLI output', status: 'pass', notes: 'Unaffected.' }],
        informational: ['PR #860 review logic is unchanged after this formatter-only update.'],
        strengths: [],
        overallAssessment: 'approved_with_notes',
        overallRationale: 'The renderer still blocks actual ad hoc headings.',
      })
    );

    expect(validation.ok).toBe(true);
  });

  test('allows plain prose that starts with natural language label phrases', () => {
    const validation = reviewOutput.normalizeStructuredOutput(
      JSON.stringify({
        summary: 'Overall assessment: ready to merge after the renderer applies the shared layout.',
        findings: [],
        securityChecklist: [{ check: 'Injection safety', status: 'pass', notes: 'Covered.' }],
        ccsCompliance: [{ rule: 'ASCII-only CLI output', status: 'pass', notes: 'Unaffected.' }],
        informational: ['Security Checklist: rows still escape pipes safely in markdown tables.'],
        strengths: [],
        overallAssessment: 'approved_with_notes',
        overallRationale: 'The prose can mention those phrases without becoming layout markup.',
      })
    );

    expect(validation.ok).toBe(true);
  });

  test('rejects invalid non-null finding line numbers', () => {
    const validation = reviewOutput.normalizeStructuredOutput(
      JSON.stringify({
        summary: 'One finding remains.',
        findings: [
          {
            severity: 'medium',
            title: 'Location data must stay valid',
            file: 'src/example.ts',
            line: 0,
            what: 'The location line number is not a positive integer.',
            why: 'Bad location data weakens the review signal and can hide where the issue lives.',
            fix: 'Reject malformed non-null line values during normalization.',
          },
        ],
        securityChecklist: [{ check: 'Injection safety', status: 'pass', notes: 'Covered.' }],
        ccsCompliance: [{ rule: 'ASCII-only CLI output', status: 'pass', notes: 'Unaffected.' }],
        informational: [],
        strengths: [],
        overallAssessment: 'changes_requested',
        overallRationale: 'Malformed location data should not pass validation.',
      })
    );

    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain('findings[0].line is invalid');
  });
});
