import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../helpers/read-source.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '../../../docs/app');
const HTML = readSource(join(APP, 'index.html'));
const JS = readSource(join(APP, 'app.js'));

describe('rename UI – markup', () => {
  it('ships the modal, form, input and status box the script drives', () => {
    for (const id of ['rename-modal', 'rename-modal-title', 'rename-modal-close', 'rename-modal-status', 'rename-form', 'rename-new-name', 'rename-submit']) {
      assert.ok(HTML.includes(`id="${id}"`), `index.html is missing #${id}`);
    }
    assert.match(HTML, /<form id="rename-form" novalidate>/, 'the form must not fall back to browser validation');
    assert.match(HTML, /<button type="submit" id="rename-submit"/, 'the submit button must submit the form');
  });

  it('exposes the entry point and the pending note in the identity chip', () => {
    assert.ok(HTML.includes('id="chip-rename"'), 'the chip needs a rename entry point');
    assert.ok(HTML.includes('id="chip-rename-note"'), 'the chip needs the pending marker');
    assert.match(HTML, /id="chip-rename" class="not-you"/, 'rename is a secondary chip action');
  });

  it('marks the dialog as modal and labelled by its heading', () => {
    assert.match(HTML, /id="rename-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rename-modal-title"/);
  });
});

describe('rename UI – behaviour in app.js', () => {
  it('wires every control through the central on() helper, not inline handlers', () => {
    assert.ok(JS.includes("on('chip-rename', 'click', openRenameModal)"), 'chip must open the modal');
    assert.ok(JS.includes("on('rename-modal-close', 'click'"), 'close button must be wired');
    assert.ok(JS.includes("on('rename-form', 'submit'"), 'form submit must be wired');
    assert.ok(JS.includes("wireBackdrop($('rename-modal'), closeRenameModal)"), 'backdrop click must close the modal');
    assert.ok(JS.includes("'rename-modal'].forEach"), 'the modal must be registered with the overlay handling');
  });

  it('opens on a clean input and renders the stored request state', () => {
    assert.match(JS, /function openRenameModal\(\)[\s\S]*?input\.value = ''[\s\S]*?renderRenameStatus\(\)[\s\S]*?openOverlay\('rename-modal'\)/);
  });

  it('prefills a pending request and offers an overwrite instead of a lockout', () => {
    assert.match(JS, /req\.status === 'pending'[\s\S]*?input\.value = req\.newMeleeName/);
    assert.match(JS, /req\.status === 'pending'[\s\S]*?submit\.textContent = 'Update Request'/);
    assert.ok(JS.includes('Submit again to change it'), 'the member must be told the request stays editable');
  });

  it('shows the rejection reason the backend sends, but nothing for approvals', () => {
    assert.match(JS, /req\.status === 'rejected'[\s\S]*?req\.note/);
    assert.ok(!/req\.status === 'approved'[\s\S]{0,200}?req\.note/.test(JS), 'the merge note must stay internal');
  });

  it('sends the declared name to requestRename and keeps the submit disabled while in flight', () => {
    assert.match(JS, /function submitRenameRequest\(\)[\s\S]*?submit\.disabled = true[\s\S]*?callApi\('requestRename', \{ newMeleeName: value \}\)/);
    assert.match(JS, /catch \(err\)[\s\S]*?showRenameStatus\([^)]*\)[\s\S]*?submit\.disabled = false/);
  });

  it('rejects an empty submission without calling the API', () => {
    assert.match(JS, /if \(!value\) \{[\s\S]*?showRenameStatus\('Enter your new Melee username\.', false\);[\s\S]*?return;/);
  });

  it('only shows the chip note while a request is pending', () => {
    assert.match(JS, /const pending = appState\.renameRequest && appState\.renameRequest\.status === 'pending'/);
    assert.match(JS, /note\.style\.display = pending \? 'inline' : 'none'/);
  });

  it('drops the stored identity when the backend reports an invalid token', () => {
    assert.match(JS, /boot\.status === 'invalid-token'[\s\S]*?clearSession\(\)/);
  });
});
