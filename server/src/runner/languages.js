/**
 * Supported languages and how each is built/run inside the sandbox container.
 *
 * Two mounts exist:
 *   /sandbox — the submitted source, always read-only
 *   /build   — the compile artifact directory, writable during `compile` and
 *              read-only during every `run`
 *
 * The artifact directory exists because /tmp is a per-container tmpfs: a binary
 * compiled in the compile container would not survive into the run containers.
 * Narrowing it back to read-only before any untrusted code executes keeps the
 * writable window scoped to the compiler itself.
 */
export const LANGUAGES = {
  python: {
    id: 'python',
    label: 'Python 3.11',
    image: 'oj-runner-python:latest',
    // Judge0 language id, used only when EXECUTION_PROVIDER=judge0. Versions
    // differ slightly from the local images; both are modern enough that no
    // seeded problem depends on the difference.
    judge0Id: 113,
    sourceFile: 'main.py',
    compile: null,
    // -I: isolated mode — ignores env vars and the user site directory.
    run: ['python3', '-I', '/sandbox/main.py'],
    env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1', HOME: '/tmp' },
  },
  cpp: {
    id: 'cpp',
    label: 'C++17 (g++)',
    image: 'oj-runner-cpp:latest',
    judge0Id: 105,
    sourceFile: 'main.cpp',
    compile: ['g++', '-std=c++17', '-O2', '-static', '-o', '/build/program', '/sandbox/main.cpp'],
    run: ['/build/program'],
    env: { HOME: '/tmp' },
  },
  javascript: {
    id: 'javascript',
    label: 'JavaScript (Node 20)',
    image: 'oj-runner-node:latest',
    judge0Id: 102,
    sourceFile: 'main.js',
    compile: null,
    run: ['node', '/sandbox/main.js'],
    env: { HOME: '/tmp', NODE_OPTIONS: '--max-old-space-size=192' },
  },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES);

export function getLanguage(id) {
  return LANGUAGES[id] ?? null;
}
