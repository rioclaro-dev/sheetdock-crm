import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
export function check(){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 assert.equal(manifest.manifest_version,3);
 assert.deepEqual(manifest.permissions,['storage','identity']);
 assert.deepEqual(manifest.host_permissions,['https://sheets.googleapis.com/*']);
 assert.deepEqual(manifest.content_scripts[0].matches,['https://web.whatsapp.com/*']);
 assert.equal(manifest.content_scripts.length,1);
 assert.ok(!manifest.key&&!manifest.oauth2,'Source manifest must not carry credentials from another product');
 const referenced=[manifest.background.service_worker,manifest.action.default_popup,manifest.options_ui.page,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(c=>c.js),...manifest.web_accessible_resources.flatMap(r=>r.resources)];
 for(const file of referenced)assert.ok(fs.existsSync(path.join(root,file)),`Missing manifest resource ${file}`);
 const privatePattern=/magnetis|btgpactual|n8n\.|localhost:\d+/i;
 const allowedDomains=new Set(['web.whatsapp.com','sheets.googleapis.com','docs.google.com','myaccount.google.com','www.googleapis.com']);
 const files=walk(path.join(root,'src'));
 for(const f of files){if(!/\.(js|css|html)$/.test(f))continue;const content=fs.readFileSync(f,'utf8');assert.ok(!privatePattern.test(content),`Private integration reference in ${path.relative(root,f)}`);for(const match of content.matchAll(/https:\/\/[a-z0-9.-]+/ig))assert.ok(allowedDomains.has(new URL(match[0]).hostname),`Unexpected network domain in ${f}`);assert.ok(!/\b(?:eval|new\s+Function)\s*\(/.test(content),`Dynamic executable code in ${f}`);assert.ok(!/https?:\/\/[^\s"'<>]*\.(?:js|mjs)(?:["'\s]|$)/.test(content),`Remote code in ${f}`);if(f.endsWith('.html'))assert.ok(!/\bon\w+\s*=/.test(content),`Inline executable handler in ${f}`);if(f.endsWith('.js')){const result=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}}
 const publicFolders=['src','scripts','tests','docs','.github','icons'];
 const publicFiles=publicFolders.filter(d=>fs.existsSync(path.join(root,d))).flatMap(d=>walk(path.join(root,d))).concat(fs.readdirSync(root).filter(n=>fs.statSync(path.join(root,n)).isFile()).map(n=>path.join(root,n)));
 for(const f of publicFiles){if(!/\.(?:js|mjs|cjs|json|md|html|css|ya?ml|svg)$/.test(f))continue;const content=fs.readFileSync(f,'utf8');assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content),`Private key in ${path.relative(root,f)}`);assert.ok(!/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/.test(content),`Credential-like value in ${path.relative(root,f)}`);assert.ok(!/\d+-[a-z0-9]{20,}\.apps\.googleusercontent\.com/.test(content),`Hardcoded OAuth client in ${path.relative(root,f)}`);}
 for(const size of [16,48,128]){const b=fs.readFileSync(path.join(root,`icons/icon-${size}.png`));assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);}
 console.log(`Static audit passed: ${files.length} source files, permissions, syntax, icons and private integration removal.`);
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))check();
