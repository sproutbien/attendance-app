// After `vite build --mode hosting`: add the Apache rules, drop public/ files that aren't in git
// (local screenshots/mockups), and zip the folder ready to upload into public_html/desk.
import { copyFileSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { join } from 'node:path'

const out = 'dist-hosting'
copyFileSync('hosting/.htaccess', `${out}/.htaccess`)
const tracked = new Set(execSync('git ls-files public', { encoding: 'utf8' }).split('\n').filter(Boolean).map(f => f.slice('public/'.length)))
for (const f of readdirSync('public')) if (!tracked.has(f)) rmSync(`${out}/${f}`, { recursive: true, force: true })
// The GitHub Action uploads dist-hosting straight over FTP; the zip is only for manual uploads from Windows
if (process.platform !== 'win32') process.exit(0)
rmSync('desk-upload.zip', { force: true })
// Windows' own tar (bsdtar) writes a real .zip; Git Bash's GNU tar would not
execFileSync(join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-c', '-f', '../desk-upload.zip', ...readdirSync(out)], { cwd: out, stdio: 'inherit' })
console.log('Ready: desk-upload.zip — extract its contents into public_html/desk/')
