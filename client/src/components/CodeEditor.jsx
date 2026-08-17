import { useRef } from 'react';

const STARTERS = {
  python: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    # your solution here\n\nmain()\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // your solution here\n    return 0;\n}\n',
  javascript:
    "const data = require('fs').readFileSync(0, 'utf8').split(/\\s+/);\n\n// your solution here\n",
};

export function starterFor(language) {
  return STARTERS[language] ?? '';
}

/** Contract is (value, onChange, language), so Monaco or CodeMirror drops in. */
export default function CodeEditor({ value, onChange, language, languages, onLanguageChange, disabled }) {
  const ref = useRef(null);

  // Tab should indent, not move focus out of the editor.
  const handleKeyDown = (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();

    const el = ref.current;
    const { selectionStart, selectionEnd } = el;
    const next = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
    onChange(next);

    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 4;
    });
  };

  const lineCount = value.split('\n').length;

  return (
    <div className="editor-wrap">
      <div className="editor-bar">
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          disabled={disabled}
          aria-label="Language"
        >
          {languages.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <span className="faint">{lineCount} lines</span>
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => onChange(starterFor(language))}
          disabled={disabled}
        >
          Reset to template
        </button>
      </div>
      <textarea
        ref={ref}
        className="code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        disabled={disabled}
        aria-label="Source code"
      />
    </div>
  );
}
