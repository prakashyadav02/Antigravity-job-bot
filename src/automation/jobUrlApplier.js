import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBrowser, randomSleep } from './browser.js';
import { loadProfile, isCompanyExcluded } from '../config.js';
import { recordApplication, isAlreadyApplied } from '../tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LINKEDIN_STORAGE = path.resolve(__dirname, '../../data/linkedin_storage_state.json');
const NAUKRI_STORAGE = path.resolve(__dirname, '../../data/naukri_storage_state.json');

/**
 * Extracts company and job title from common ATS / job portal URL structures
 */
export function parseJobDetailsFromUrl(jobUrl = '') {
  let company = '';
  let title = '';
  if (!jobUrl) return { company, title };

  try {
    const urlObj = new URL(jobUrl);
    const host = urlObj.hostname.toLowerCase();
    const pathname = decodeURIComponent(urlObj.pathname);

    if (host.includes('linkedin.com')) {
      const match = pathname.match(/\/jobs\/view\/([^/?#]+)/i);
      if (match) {
        const slug = match[1];
        if (slug.includes('-at-')) {
          const parts = slug.split('-at-');
          title = parts[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
          company = parts[1].replace(/-\d+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
        } else {
          title = slug.replace(/-\d+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
        }
      }
    } else if (host.includes('greenhouse.io')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts[0] === 'jobs' && parts[1]) company = parts[1];
      else if (parts[0]) company = parts[0];
      company = company.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    } else if (host.includes('lever.co')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts[0]) company = parts[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    } else if (host.includes('ashbyhq.com')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts[0]) company = parts[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    } else if (host.includes('myworkdayjobs.com')) {
      const sub = host.split('.')[0];
      company = sub.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    } else if (host.includes('zohorecruit.com') || host.includes('zohorecruit.in')) {
      const sub = host.split('.')[0];
      company = sub.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart && !/^\d+$/.test(lastPart)) {
          title = lastPart.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
        }
      }
    } else if (host.includes('smartrecruiters.com')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts[0]) company = parts[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
      if (parts[1]) title = parts[1].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    } else if (host.includes('taleo.net') || host.includes('icims.com')) {
      const sub = host.split('.')[0];
      company = sub.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    } else {
      const sub = host.split('.')[0];
      if (sub && !['www', 'jobs', 'careers', 'apply', 'job-boards', 'boards'].includes(sub)) {
        company = sub.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
      }
    }
  } catch {}

  return { company, title };
}

/**
 * Live UI Scanner: Reads current page DOM, detects active modals,
 * and categorizes all visible interactive elements (buttons, links, auth forms, inputs).
 */
export async function readUIState(page) {
  return await page.evaluate(() => {
    // Clear previous bot markers
    document.querySelectorAll('[data-bot-target]').forEach(e => e.removeAttribute('data-bot-target'));
    document.querySelectorAll('[data-bot-input]').forEach(e => e.removeAttribute('data-bot-input'));

    // Check for active modal/dialog overlay
    const modal = document.querySelector('[role="dialog"], .modal, .contextual-sign-in-modal, .jobs-easy-apply-modal, .dialog, div[aria-modal="true"]');
    const hasModal = !!(modal && modal.getBoundingClientRect().width > 0);
    const root = hasModal ? modal : document.body;

    const isVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };

    const cleanText = (el) => {
      return (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
    };

    // 1. Confirmation / Success & Already-Applied Detection
    const bodyText = (document.body.innerText || '').toLowerCase();
    const currentUrl = window.location.href.toLowerCase();
    const isConfirmation = currentUrl.includes('thank') || currentUrl.includes('submitted') || currentUrl.includes('confirmation') ||
      bodyText.includes('thank you for applying') || bodyText.includes('application submitted') ||
      bodyText.includes('application received') || bodyText.includes('thanks for applying') ||
      bodyText.includes('your application has been received');

    // Detect if candidate has already applied to this posting earlier
    const isAlreadyApplied = (currentUrl.includes('naukri.com') && (
      bodyText.includes('applicants: 100+\napplied') ||
      bodyText.includes('applicants:\napplied') ||
      /\bapplicants:.*\napplied\b/i.test(bodyText) ||
      document.querySelector('.applied-btn, .already-applied, [class*="already-applied"]') !== null ||
      Array.from(document.querySelectorAll('.styles_jhc__apply-button-container__5Bqnb, .apply-button-container, .apply-button, button, span, div')).some(b => b.innerText.trim().toLowerCase() === 'applied')
    )) || (
      currentUrl.includes('linkedin.com') && document.querySelector('.jobs-apply-button--disabled, [data-control-name="already_applied"], button:has-text("Applied")') !== null
    ) || (
      bodyText.includes('you have already applied') ||
      bodyText.includes('you already applied') ||
      bodyText.includes('you submitted an application for this position')
    );

    // 2. Scan Clickable Elements (Buttons & Links)
    const clickables = Array.from(root.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')).filter(isVisible);

    const cookieButtons = [];
    const applyButtons = [];
    const autofillButtons = [];
    const authGoogleButtons = [];
    const authCreateAccountButtons = [];
    const authSignInButtons = [];
    const authGuestButtons = [];
    const nextStepButtons = [];
    const submitButtons = [];

    const ts = Date.now();

    for (let i = 0; i < clickables.length; i++) {
      const el = clickables[i];
      const text = cleanText(el);
      const textLower = text.toLowerCase();
      const dataAuto = (el.getAttribute('data-automation-id') || '').toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const href = (el.getAttribute('href') || '').toLowerCase();
      const className = (el.getAttribute('class') || '').toLowerCase();
      const targetId = `btn-${ts}-${i}`;
      el.setAttribute('data-bot-target', targetId);

      const fullDesc = `${textLower} ${dataAuto} ${aria} ${href} ${className}`;

      // Cookie banner
      if (/accept.*cookie|cookie.*accept|allow.*cookie|agree.*continue|i.*agree|^agree$|accept.*all|cookie-accept|cookie.*notice/i.test(fullDesc) || dataAuto === 'legalnoticeacceptbutton' || className.includes('cookie-accept-btn')) {
        cookieButtons.push({ targetId, text, dataAuto });
      }
      // Autofill with resume
      else if (/autofill.*resume|fill.*resume|resume.*autofill/i.test(fullDesc) || dataAuto === 'autofillwithresume') {
        autofillButtons.push({ targetId, text, dataAuto });
      }
      // Submit Application
      else if (/submit.*application|complete.*application|send.*application|^submit$|^submit application$/i.test(textLower) || dataAuto === 'submitbutton') {
        submitButtons.push({ targetId, text, dataAuto });
      }
      // Next Step / Continue
      else if (/^next$|^continue$|^save.*continue$|^review$|^review.*application$/i.test(textLower) || dataAuto === 'bottomnavigationnextbutton') {
        nextStepButtons.push({ targetId, text, dataAuto });
      }
      // Google / Gmail Login
      else if (/google|sign in with google|continue with google/i.test(fullDesc)) {
        authGoogleButtons.push({ targetId, text, dataAuto });
      }
      // Guest Apply
      else if (/apply.*guest|continue.*guest|without.*account|guest.*apply/i.test(fullDesc)) {
        authGuestButtons.push({ targetId, text, dataAuto });
      }
      // Create Account / Sign Up
      else if (/create.*account|sign.*up|register|join.*now/i.test(textLower) || dataAuto === 'createaccountsubmitbutton') {
        authCreateAccountButtons.push({ targetId, text, dataAuto });
      }
      // Sign In / Log In
      else if (/^sign.*in$|^log.*in$|existing.*user/i.test(textLower) || dataAuto === 'signinbutton' || dataAuto === 'utilitybuttonsignin') {
        authSignInButtons.push({ targetId, text, dataAuto });
      }
      // General Apply Button (including Zoho "I'm interested")
      else if (/\bapply\b|\beasy apply\b|\bapply now\b|\bapply for this job\b|\bstart application\b|i'm interested|\binterested\b/i.test(textLower) || dataAuto === 'adventurebutton' || className.includes('lytesuccess')) {
        applyButtons.push({ targetId, text, dataAuto });
      }
    }

    // 3. Scan Inputs, Textareas, Selects, Checkboxes (include file inputs even if styled hidden)
    const allInputs = Array.from(root.querySelectorAll('input, textarea, select')).filter(el => {
      if (el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'file') return true;
      return isVisible(el);
    });
    const fileInputs = [];
    const formInputs = [];
    const dropdowns = [];
    const checkboxes = [];
    const authFields = { email: null, password: null, verifyPassword: null };

    for (let j = 0; j < allInputs.length; j++) {
      const inp = allInputs[j];
      const tag = inp.tagName.toLowerCase();
      const type = (inp.getAttribute('type') || tag).toLowerCase();
      const name = (inp.getAttribute('name') || '').toLowerCase();
      const id = (inp.getAttribute('id') || '').toLowerCase();
      const dataAuto = (inp.getAttribute('data-automation-id') || '').toLowerCase();
      const placeholder = (inp.getAttribute('placeholder') || '').toLowerCase();
      const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
      const labelEl = inp.closest('label') || document.querySelector(`label[for="${inp.id}"]`);
      let labelText = (labelEl ? labelEl.innerText : '').toLowerCase();

      // Multi-level label traversal for Zoho Recruit, Workday, and custom ATS web components
      if (!labelText) {
        let cur = inp;
        for (let k = 0; k < 6 && cur && cur !== document.body; k++) {
          cur = cur.parentElement;
          if (!cur) break;
          const prev = cur.previousElementSibling;
          if (prev && prev.innerText && prev.innerText.trim()) { labelText = prev.innerText.trim().toLowerCase(); break; }
          const lbl = cur.querySelector('label, .lyteFieldLabel, .cw-form-label, span.cw-label, [class*="label"]');
          if (lbl && lbl.innerText && lbl.innerText.trim()) { labelText = lbl.innerText.trim().toLowerCase(); break; }
        }
      }

      const desc = `${name} ${id} ${dataAuto} ${placeholder} ${aria} ${labelText}`;

      // Skip honeypots
      if (desc.includes('beecatcher') || desc.includes('robot') || desc.includes('honeypot')) continue;

      const inputId = `inp-${ts}-${j}`;
      inp.setAttribute('data-bot-input', inputId);

      if (type === 'file') {
        fileInputs.push({ inputId, desc });
      } else if (type === 'checkbox') {
        checkboxes.push({ inputId, desc, checked: inp.checked });
      } else if (tag === 'select') {
        dropdowns.push({ inputId, desc });
      } else if (desc.includes('verifypassword') || desc.includes('confirm.*pass') || (type === 'password' && (desc.includes('verify') || desc.includes('confirm')))) {
        authFields.verifyPassword = { inputId, desc };
      } else if (type === 'password' || desc.includes('password')) {
        authFields.password = { inputId, desc };
      } else if (type === 'email' || desc.includes('email') || desc.includes('e-mail')) {
        authFields.email = { inputId, desc, currentVal: inp.value || '' };
      } else {
        formInputs.push({ inputId, type, desc, currentVal: inp.value || '' });
      }
    }

    return {
      url: window.location.href,
      title: document.title,
      hasModal,
      isConfirmation,
      isAlreadyApplied,
      cookieButtons,
      applyButtons,
      autofillButtons,
      authGoogleButtons,
      authCreateAccountButtons,
      authSignInButtons,
      authGuestButtons,
      nextStepButtons,
      submitButtons,
      fileInputs,
      formInputs,
      dropdowns,
      checkboxes,
      authFields
    };
  });
}

/**
 * Intelligent Form Filler: Evaluates every visible input, dropdown, and checkbox,
 * maps them to candidate profile details, and triggers synthetic input/change events.
 */
async function fillCandidateFormFields(page, profile, log = console.log) {
  const firstName = profile.personal?.firstName || 'Prakash Kumar';
  const lastName = profile.personal?.lastName || 'Yadav';
  const fullName = `${firstName} ${lastName}`.trim();
  const email = profile.personal?.email || 'yadavparkash02@gmail.com';
  const phone = profile.personal?.phone?.replace(/[^0-9]/g, '') || '9220299305';
  const cleanPhone = phone.length > 10 ? phone.slice(-10) : phone;
  const location = profile.personal?.currentLocation || 'Noida, India';
  const linkedin = profile.links?.linkedin || 'https://www.linkedin.com/in/prakash-kumar-yadav-08ab551ba';
  const github = profile.links?.github || 'https://github.com/prakashyadav02';
  const totalExp = String(profile.experience?.totalYears || '2.8+').replace(/[^0-9.]/g, '') || '2.8';
  const noticeDays = String(profile.workPreferences?.effectiveNoticePeriodDays || 15);
  const currentCtc = String(profile.workPreferences?.currentSalary || '10 LPA').replace(/[^0-9.]/g, '') || '10';
  const expectedCtc = String(profile.workPreferences?.expectedSalary || '15 LPA').replace(/[^0-9.]/g, '') || '15';
  const currentCompany = profile.experience?.currentCompany || 'SOLIZE India Technologies Private Limited';
  const currentTitle = profile.experience?.currentTitle || 'Data Engineer';
  const skills = profile.customAnswers?.primarySkills || 'Python, SQL, PySpark, Apache Spark, Databricks, Apache Airflow, Kafka, AWS S3';

  // 1. Text Inputs, Comboboxes (react-select), and Textareas
  const allFormInputs = await page.locator('[data-bot-input]').all();
  let filledCount = 0;

  for (const inp of allFormInputs) {
    const isVis = await inp.isVisible().catch(() => false);
    if (!isVis) continue;

    const tag = await inp.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
    const type = (await inp.getAttribute('type').catch(() => '')) || tag;
    const role = (await inp.getAttribute('role').catch(() => '')) || '';
    const className = (await inp.getAttribute('class').catch(() => '')) || '';
    if (type === 'file' || type === 'checkbox' || type === 'radio' || tag === 'select') continue;

    const existingVal = await inp.inputValue().catch(() => '');
    if (existingVal && existingVal.length > 0) continue; // Already filled

    const desc = await inp.evaluate(el => {
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      const dataAuto = el.getAttribute('data-automation-id') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const aria = el.getAttribute('aria-label') || '';
      let label = el.closest('label')?.innerText || document.querySelector(`label[for="${el.id}"]`)?.innerText || '';
      if (!label) {
        let cur = el;
        for (let k = 0; k < 6 && cur && cur !== document.body; k++) {
          cur = cur.parentElement;
          if (!cur) break;
          const prev = cur.previousElementSibling;
          if (prev && prev.innerText && prev.innerText.trim()) { label = prev.innerText.trim(); break; }
          const lbl = cur.querySelector('label, .lyteFieldLabel, .cw-form-label, span.cw-label, [class*="label"]');
          if (lbl && lbl.innerText && lbl.innerText.trim()) { label = lbl.innerText.trim(); break; }
        }
      }
      return `${name} ${id} ${dataAuto} ${placeholder} ${aria} ${label}`.toLowerCase().replace(/\s+/g, ' ');
    }).catch(() => '');

    const isCombobox = role === 'combobox' || className.includes('select__input') || desc.includes('select...');

    let fillVal = '';

    // Smart semantic matching
    if (/country/i.test(desc)) fillVal = 'India';
    else if (/nationality/i.test(desc)) fillVal = 'Indian';
    else if (/privacy|acknowledg/i.test(desc)) fillVal = 'Acknowledge';
    else if (/discrepanc|abscond|criminal|uan/i.test(desc)) fillVal = 'No';
    else if (/hybrid|wfo|relocat/i.test(desc)) fillVal = 'Yes';
    else if (/databricks|pyspark|python.*pyspark/i.test(desc)) fillVal = 'Yes';
    else if (/currently.*working/i.test(desc)) fillVal = 'Yes';
    else if (/first.*name|given.*name/i.test(desc)) fillVal = firstName;
    else if (/last.*name|family.*name|surname/i.test(desc)) fillVal = lastName;
    else if (/preferred.*name/i.test(desc)) fillVal = firstName;
    else if (/full.*name|\bname\b/i.test(desc)) fillVal = fullName;
    else if (/email/i.test(desc)) fillVal = email;
    else if (/phone|mobile|contact|tel|\(\+91\)/i.test(desc)) fillVal = cleanPhone;
    else if (/preferred.*location/i.test(desc)) fillVal = 'Pune';
    else if (/current.*location|work.*location|city|address/i.test(desc)) fillVal = location;
    else if (/linkedin/i.test(desc)) fillVal = linkedin;
    else if (/github/i.test(desc)) fillVal = github;
    else if (/designation|job.*title/i.test(desc)) fillVal = currentTitle;
    else if (/payroll|current.*company|employer|organization/i.test(desc)) fillVal = currentCompany;
    else if (/holding.*offer/i.test(desc)) fillVal = 'None / Actively Interviewing';
    else if (/serving.*notice/i.test(desc)) fillVal = 'Not Serving (15 Days Notice)';
    else if (/how.*soon|join/i.test(desc)) fillVal = isCombobox ? '15 Days' : '15 Days';
    else if (/official.*notice/i.test(desc)) fillVal = '15 Days';
    else if (/experience.*month/i.test(desc)) fillVal = String(Math.round(parseFloat(totalExp || '2.8') * 12)) || '34';
    else if (/notice/i.test(desc)) fillVal = noticeDays;
    else if (/overall.*exp|total.*exp|years.*experience/i.test(desc)) fillVal = isCombobox ? '2' : totalExp;
    else if (/data.*engineering.*exp/i.test(desc)) fillVal = totalExp;
    else if (/current.*(ctc|salary|package)/i.test(desc)) fillVal = currentCtc + ' LPA';
    else if (/expected.*(ctc|salary|package)|desired.*(ctc|salary)/i.test(desc)) fillVal = expectedCtc + ' LPA';
    else if (/gender/i.test(desc)) fillVal = 'Male';
    else if (/skills|technolog/i.test(desc)) fillVal = skills;

    if (fillVal) {
      if (isCombobox) {
        log(`   👉 Selected combobox [${desc.slice(0, 32).trim()}]: "${fillVal}"`);
        try {
          const control = inp.locator('xpath=ancestor::div[contains(@class, "select__control") or contains(@class, "control")]').first();
          const canClick = await control.isVisible().catch(() => false);
          if (canClick) {
            await control.click().catch(() => {});
          } else {
            await inp.click({ force: true }).catch(() => inp.focus().catch(() => {}));
          }
          await randomSleep(250, 450);

          const optSelector = `.select__menu .select__option:has-text("${fillVal}"), div[class*="-option"]:has-text("${fillVal}"), [role="option"]:has-text("${fillVal}")`;
          const opt = page.locator(optSelector).first();
          if (await opt.isVisible({ timeout: 1500 }).catch(() => false)) {
            await opt.click().catch(() => {});
          } else {
            await inp.type(fillVal, { delay: 40 }).catch(() => {});
            await randomSleep(200, 350);
            await page.keyboard.press('Enter').catch(() => {});
          }
        } catch {
          await inp.type(fillVal, { delay: 40 }).catch(() => {});
          await page.keyboard.press('Enter').catch(() => {});
        }
        await randomSleep(200, 350);
      } else {
        log(`   ✍️ Filled field [${desc.slice(0, 32).trim()}]: "${fillVal}"`);
        await inp.fill(fillVal).catch(() => {});
        await inp.evaluate(el => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }).catch(() => {});
        await randomSleep(150, 300);
      }
      filledCount++;
    }
  }

  // 2. Dropdowns (select)
  const selects = await page.locator('select').all();
  for (const sel of selects) {
    if (!(await sel.isVisible().catch(() => false))) continue;
    const selDesc = await sel.evaluate(el => `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase()).catch(() => '');
    if (/notice/i.test(selDesc)) {
      await sel.selectOption({ label: '15 Days' }).catch(() => sel.selectOption({ index: 1 })).catch(() => {});
      log(`   👉 Selected Notice Period: "15 Days"`);
    } else if (/experience/i.test(selDesc)) {
      await sel.selectOption({ index: 2 }).catch(() => {});
    } else if (/authoriz/i.test(selDesc)) {
      await sel.selectOption({ label: 'Yes' }).catch(() => sel.selectOption({ index: 1 })).catch(() => {});
      log(`   👉 Selected Work Authorization: "Yes"`);
    } else if (/sponsorship/i.test(selDesc)) {
      await sel.selectOption({ label: 'No' }).catch(() => sel.selectOption({ index: 2 })).catch(() => {});
      log(`   👉 Selected Visa Sponsorship: "No"`);
    } else if (/gender/i.test(selDesc)) {
      await sel.selectOption({ label: 'Male' }).catch(() => sel.selectOption({ index: 1 })).catch(() => {});
    }
  }

  // 3. Agreement / Policy Checkboxes
  const checkboxes = await page.locator('input[type="checkbox"]').all();
  for (const cb of checkboxes) {
    if (!(await cb.isVisible().catch(() => false))) continue;
    const isChecked = await cb.isChecked().catch(() => false);
    if (!isChecked) {
      await cb.check({ force: true }).catch(() => {});
      log(`   ☑️ Checked consent / terms checkbox.`);
    }
  }

  return filledCount;
}

/**
 * Universal Autonomous UI-First Job Link Applier:
 * Instead of static hardcoded selectors, this engine:
 * 1. Reads the screen UI state dynamically at every step.
 * 2. Checks where "Apply", "Autofill with Resume", "Sign In", "Create Account", or "Gmail/Google Login" are located.
 * 3. Takes intelligent step-by-step decisions:
 *    - Dismisses blocker cookie banners.
 *    - Navigates through Apply / Autofill buttons.
 *    - Handles Auth / Account Creation (or bypasses via Guest Apply).
 *    - Attaches active resume PDF.
 *    - Automatically pre-fills all screening fields, dropdowns, and consent boxes.
 *    - Advances wizard steps (Next / Save and Continue) until final Submit.
 *    - Verifies real confirmation on screen.
 * 4. Streams live, user-friendly execution logs to the dashboard terminal!
 */
export async function applyToJobUrl(jobUrl, options = {}) {
  const log = (msg) => {
    console.log(msg);
    if (typeof options.onLog === 'function') {
      try { options.onLog(msg); } catch {}
    }
  };

  const autoParsed = parseJobDetailsFromUrl(jobUrl);
  const companyName = (options.companyName || autoParsed.company || '').trim();
  const jobTitle = (options.jobTitle || autoParsed.title || 'Engineering Role').trim();
  const headless = options.headless !== undefined ? options.headless : true;

  log(`\n============================================================`);
  log(`⚡ [UI-FIRST AUTO-APPLIER] Initiating Autonomous Job Application`);
  log(`🔗 Target URL: ${jobUrl}`);
  if (companyName) log(`🏢 Employer: ${companyName} | 💼 Target Role: ${jobTitle}`);
  log(`============================================================`);

  if (isCompanyExcluded(companyName, jobUrl)) {
    log(`🛡️ [Safety Shield] Employer "${companyName}" is in your excluded list. Skipping.`);
    return { success: false, status: 'EXCLUDED', error: 'Employer is in excluded companies list.' };
  }

  const profile = loadProfile();
  const email = profile.personal?.email || 'yadavparkash02@gmail.com';

  let resumePath = profile.documents?.resumePath;
  if (!resumePath || !fs.existsSync(resumePath)) {
    const dataDir = path.resolve(__dirname, '../../data');
    const pdfs = fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.pdf')) : [];
    if (pdfs.length > 0) resumePath = path.join(dataDir, pdfs[0]);
  }
  const resumeName = resumePath ? path.basename(resumePath) : 'Resume.pdf';

  const standalone = options.standalone !== undefined ? options.standalone : true;
  const browserOptions = { headless };

  // Only attach external storage state if explicitly requested (non-standalone mode)
  if (!standalone && options.useSavedSession) {
    if (jobUrl.includes('naukri.com') && fs.existsSync(NAUKRI_STORAGE)) {
      try {
        const nState = JSON.parse(fs.readFileSync(NAUKRI_STORAGE, 'utf-8'));
        if (Array.isArray(nState.cookies) && nState.cookies.length >= 3) {
          browserOptions.storageState = NAUKRI_STORAGE;
        }
      } catch {}
    } else if (fs.existsSync(LINKEDIN_STORAGE)) {
      try {
        const state = JSON.parse(fs.readFileSync(LINKEDIN_STORAGE, 'utf-8'));
        if (Array.isArray(state.cookies) && state.cookies.length >= 3) {
          browserOptions.storageState = LINKEDIN_STORAGE;
        }
      } catch {}
    }
  }

  log(`🛡️ [Mode] Running in 100% Standalone Self-Contained Engine (Zero Session Dependency)`);
  const { browser, page } = await createBrowser(browserOptions);

  try {
    log(`🌐 [UI Step 1] Navigating to job page: ${jobUrl}`);
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await randomSleep(2000, 3000);

    let activePage = page;
    let resumeUploaded = false;
    let maxSteps = 12;
    let lastUrl = '';
    let sameUrlCount = 0;

    let curCompanyName = companyName;
    let curJobTitle = jobTitle;

    for (let step = 1; step <= maxSteps; step++) {
      const currentUrl = activePage.url();
      const currentTitle = (await activePage.title().catch(() => '')) || '';

      // Recovery from browser connection or transient chrome-error page
      if (currentUrl.includes('chrome-error') || currentUrl.includes('chromewebdata')) {
        log(`⚠️ [Network Recovery] Detected browser navigation glitch (${currentUrl}). Re-navigating to job URL...`);
        await activePage.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
        await randomSleep(2500, 3500);
        continue;
      }

      if (currentUrl === lastUrl) {
        sameUrlCount++;
      } else {
        sameUrlCount = 0;
        lastUrl = currentUrl;
      }

      log(`\n🔍 [UI Step ${step}] Reading Screen: "${currentTitle.slice(0, 45)}"`);
      log(`   URL: ${currentUrl}`);

      // Dynamic Employer & Role discovery fallback
      if (!curCompanyName || curCompanyName.toLowerCase() === 'company') {
        const detectedCompany = await activePage.evaluate(() => {
          const og = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
          if (og && og.trim() && !og.toLowerCase().includes('job')) return og.trim();
          const t = document.title || '';
          if (t.includes(' - ')) return t.split(' - ')[0].trim();
          if (t.includes(' | ')) return t.split(' | ')[0].trim();
          return '';
        }).catch(() => '');
        if (detectedCompany) {
          curCompanyName = detectedCompany;
          log(`🏢 [Auto-Detected Employer]: "${curCompanyName}"`);
          if (isCompanyExcluded(curCompanyName, jobUrl)) {
            log(`🛡️ [Safety Shield] Discovered employer "${curCompanyName}" is in your excluded list. Skipping.`);
            return { success: false, status: 'EXCLUDED', error: 'Employer is in excluded companies list.' };
          }
        }
      }

      if (!curJobTitle || curJobTitle === 'Engineering Role') {
        const detectedTitle = await activePage.evaluate(() => {
          const h1 = document.querySelector('h1, [data-automation-id="jobPostingHeader"]')?.innerText;
          if (h1 && h1.trim().length > 3 && h1.trim().length < 80) return h1.trim();
          const t = document.title || '';
          if (t.includes(' - ')) {
            const parts = t.split(' - ');
            if (parts[1]) return parts[1].split(' in ')[0].trim();
          }
          return '';
        }).catch(() => '');
        if (detectedTitle) {
          curJobTitle = detectedTitle;
          log(`💼 [Auto-Detected Role]: "${curJobTitle}"`);
        }
      }

      // Read live UI state
      const ui = await readUIState(activePage);

      // --- DECISION 0: ALREADY APPLIED ON PORTAL ---
      if (ui.isAlreadyApplied) {
        log(`ℹ️ [Already Applied] You have already applied to this ${companyName || 'Employer'} position earlier!`);
        log(`   (Job portals only send confirmation email once upon initial application).`);
        recordApplication({
          company: companyName || 'Company',
          title: jobTitle || 'Engineering Role',
          url: jobUrl,
          platform: jobUrl.includes('naukri') ? 'NAUKRI' : 'PORTAL_DIRECT',
          status: 'ALREADY_APPLIED',
          notes: 'Already applied on portal earlier'
        });
        if (options.leadId) {
          try {
            const { updateLeadApplyStatus } = await import('../scrapers/recruiterFinder.js');
            updateLeadApplyStatus(options.leadId, 'APPLIED');
          } catch {}
        }
        return {
          success: true,
          status: 'ALREADY_APPLIED',
          message: `You have already applied to ${companyName || 'Employer'} earlier on Naukri! (Confirmation email was sent during your initial application).`
        };
      }

      // --- DECISION 1: SUCCESS CONFIRMATION ---
      if (ui.isConfirmation) {
        log(`🎉 [UI Step ${step}] Application Confirmation Detected on screen!`);
        log(`   Status: Application successfully submitted to ${companyName || 'Employer'}!`);
        recordApplication({
          company: companyName || 'Company',
          title: jobTitle || 'Engineering Role',
          url: jobUrl,
          platform: 'PORTAL_DIRECT',
          status: 'SUBMITTED',
          notes: 'Submitted via UI-First Auto-Applier'
        });
        return {
          success: true,
          status: 'SUBMITTED',
          message: `Application submitted to ${companyName || 'Employer'}!`
        };
      }

      // --- DECISION 2: COOKIE BANNER DISMISSAL ---
      if (ui.cookieButtons.length > 0) {
        const cookie = ui.cookieButtons[0];
        log(`🍪 [UI Step ${step}] Detected Cookie / Privacy banner ("${cookie.text || 'Accept'}"). Dismissing...`);
        await activePage.locator(`[data-bot-target="${cookie.targetId}"]`).first().click({ force: true }).catch(() => {});
        await randomSleep(1000, 1500);
        continue;
      }

      // --- DECISION 3: INITIAL APPLY / AUTOFILL WITH RESUME BUTTON ---
      // If we are on a job details page and an "Autofill with Resume" or "Apply" button is visible
      if (ui.autofillButtons.length > 0 && ui.formInputs.length === 0) {
        const targetBtn = ui.autofillButtons[0];
        log(`📄 [UI Step ${step}] Detected "${targetBtn.text}" button. Selecting automatic resume parsing...`);
        await activePage.locator(`[data-bot-target="${targetBtn.targetId}"]`).first().click({ force: true }).catch(() => {});
        await randomSleep(3000, 4500);
        continue;
      }

      if (ui.applyButtons.length > 0 && ui.formInputs.length === 0 && !ui.authFields.email) {
        const targetBtn = ui.applyButtons[0];
        const btnText = targetBtn.text || 'Apply';
        log(`🖱️ [UI Step ${step}] Detected Job Posting page with "${btnText}" button. Clicking to open application...`);

        // Handle potential new tab / popup
        const [popup] = await Promise.all([
          activePage.context().waitForEvent('page', { timeout: 6000 }).catch(() => null),
          activePage.locator(`[data-bot-target="${targetBtn.targetId}"]`).first().click({ force: true }).catch(() => {})
        ]);

        if (popup) {
          activePage = popup;
          await activePage.waitForLoadState('domcontentloaded').catch(() => {});
          log(`🌐 [UI Step ${step}] Application opened in new tab: ${activePage.url()}`);
        } else {
          await randomSleep(2500, 4000);
        }
        continue;
      }

      // --- DECISION 4: AUTH / LOGIN / SIGNUP SCREEN ---
      // 4A: Guest Apply (Best Path - Bypass Account Creation)
      if (ui.authGuestButtons.length > 0) {
        const guestBtn = ui.authGuestButtons[0];
        log(`👤 [UI Step ${step}] Detected "${guestBtn.text}" option! Bypassing account creation...`);
        await activePage.locator(`[data-bot-target="${guestBtn.targetId}"]`).first().click({ force: true }).catch(() => {});
        await randomSleep(2500, 3500);
        continue;
      }

      // 4B: Create Account Form (has verifyPassword field)
      if (ui.authFields.email && ui.authFields.verifyPassword) {
        log(`🔐 [UI Step ${step}] Detected Candidate Account Registration form.`);
        log(`   Pre-filling candidate email (${email}) & setting credentials...`);

        if (ui.authFields.email) {
          await activePage.locator(`[data-bot-input="${ui.authFields.email.inputId}"]`).first().fill(email).catch(() => {});
        }
        const autoPass = 'WorkdayPass@2026!';
        if (ui.authFields.password) {
          await activePage.locator(`[data-bot-input="${ui.authFields.password.inputId}"]`).first().fill(autoPass).catch(() => {});
        }
        if (ui.authFields.verifyPassword) {
          await activePage.locator(`[data-bot-input="${ui.authFields.verifyPassword.inputId}"]`).first().fill(autoPass).catch(() => {});
        }

        // Check required consent checkboxes
        for (const cb of ui.checkboxes) {
          await activePage.locator(`[data-bot-input="${cb.inputId}"]`).first().check({ force: true }).catch(() => {});
        }

        const createSubmit = ui.authCreateAccountButtons[0] || ui.submitButtons[0];
        if (createSubmit) {
          log(`🚀 [UI Step ${step}] Submitting Candidate Account Creation ("${createSubmit.text || 'Create Account'}")...`);
          await activePage.locator(`[data-bot-target="${createSubmit.targetId}"]`).first().click({ force: true }).catch(() => {});
          await randomSleep(5000, 7000);
        }
        continue;
      }

      // 4C: Sign In / Login Form (has email & password, but no verifyPassword)
      if (ui.authFields.email && ui.authFields.password && !ui.authFields.verifyPassword) {
        log(`🔑 [UI Step ${step}] Detected Sign In / Login form.`);
        log(`   Pre-filling credentials for ${email}...`);

        await activePage.locator(`[data-bot-input="${ui.authFields.email.inputId}"]`).first().fill(email).catch(() => {});
        const autoPass = 'WorkdayPass@2026!';
        await activePage.locator(`[data-bot-input="${ui.authFields.password.inputId}"]`).first().fill(autoPass).catch(() => {});

        const signInBtn = ui.authSignInButtons[0] || ui.submitButtons[0];
        if (signInBtn) {
          log(`🚀 [UI Step ${step}] Clicking "${signInBtn.text || 'Sign In'}"...`);
          await activePage.locator(`[data-bot-target="${signInBtn.targetId}"]`).first().click({ force: true }).catch(() => {});
          await randomSleep(4000, 6000);
        }
        continue;
      }

      // 4C: Sign in with Google / Gmail Login
      if (ui.authGoogleButtons.length > 0 && ui.formInputs.length === 0) {
        const googleBtn = ui.authGoogleButtons[0];
        log(`🔑 [UI Step ${step}] Detected "${googleBtn.text}" (Gmail Login) option.`);
        log(`   Selecting Google Sign-In...`);

        const [googlePopup] = await Promise.all([
          activePage.context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
          activePage.locator(`[data-bot-target="${googleBtn.targetId}"]`).first().click({ force: true }).catch(() => {})
        ]);

        if (googlePopup) {
          log(`🌐 [UI Step ${step}] Google Sign-In dialog opened.`);
          const emailInput = googlePopup.locator('input[type="email"], #identifierId').first();
          if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
            log(`✍️ [UI Step ${step}] Pre-filling Google email: ${email}`);
            await emailInput.fill(email);
            const nextBtn = googlePopup.locator('button:has-text("Next"), #identifierNext').first();
            if (await nextBtn.isVisible().catch(() => false)) await nextBtn.click();
            await randomSleep(2000, 3000);
          }
        }
        continue;
      }

      // 4D: Aggregator (LinkedIn / Naukri / Indeed) External Career Link Discovery
      if (currentUrl.includes('linkedin.com') || currentUrl.includes('naukri.com') || currentUrl.includes('indeed.com')) {
        // 1. Check DOM anchors for direct employer career links
        const externalLink = await activePage.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          for (const a of anchors) {
            const h = a.href.toLowerCase();
            if ((h.includes('greenhouse.io') || h.includes('lever.co') || h.includes('myworkdayjobs.com') || h.includes('ashbyhq.com') || h.includes('smartrecruiters.com') || h.includes('taleo.net') || h.includes('icims.com') || h.includes('/careers') || h.includes('/jobs/')) && !h.includes('linkedin.com') && !h.includes('naukri.com') && !h.includes('indeed.com')) {
              return a.href;
            }
          }
          return null;
        }).catch(() => null);

        if (externalLink) {
          log(`🌐 [UI Step ${step}] Discovered direct company application link in DOM: ${externalLink}`);
          log(`   Navigating directly to employer portal (standalone)...`);
          await activePage.goto(externalLink, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await randomSleep(2500, 3500);
          continue;
        }

        // 2. Search description text for external application URL
        const descText = (await activePage.locator('.show-more-less-html__markup, .description__text, .styles_JSp__job-desc, body').innerText().catch(() => '')) || '';
        const urlMatch = descText.match(/https?:\/\/[^\s"'<>]*(?:careers|jobs|greenhouse|lever\.co|ashbyhq|workday|smartrecruiters|taleo|icims)[^\s"'<>]*/i);

        if (urlMatch) {
          const directUrl = urlMatch[0];
          log(`🌐 [UI Step ${step}] Extracted direct employer career URL from post description: ${directUrl}`);
          log(`   Navigating directly to employer portal...`);
          await activePage.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await randomSleep(2500, 3500);
          continue;
        }

        // 3. Search for recruiter email in description
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
        const foundEmails = (descText.match(emailRegex) || []).filter(e => !e.includes('example.com') && !e.includes('sentry') && !e.includes('.png'));
        if (foundEmails.length > 0) {
          const recruiterMail = foundEmails[0].toLowerCase();
          log(`📬 [UI Step ${step}] Found recruiter email in post: ${recruiterMail}`);
          log(`   Delivering tailored application with resume to recruiter...`);
          try {
            const { sendColdEmailToRecruiter } = await import('../email/recruiterMailer.js');
            await sendColdEmailToRecruiter({
              company: companyName,
              title: jobTitle,
              targetEmail: recruiterMail,
              jobUrl
            });
            return {
              success: true,
              status: 'EMAIL_SENT',
              message: `Delivered direct application email with resume to ${recruiterMail}!`
            };
          } catch (mErr) {
            log(`⚠️ Cold mail delivery note: ${mErr.message}`);
          }
        }

        if (ui.hasModal || ui.authSignInButtons.length > 0) {
          return {
            success: false,
            status: 'NEEDS_EXTERNAL_PORTAL',
            error: `This job post requires applying on ${companyName || 'the employer'}'s external portal. Please paste the direct career portal URL or click Apply on LinkedIn ↗ in dashboard!`
          };
        }
      }

      // --- DECISION 5: RESUME ATTACHMENT ---
      if (ui.fileInputs.length > 0 && !resumeUploaded && resumePath && fs.existsSync(resumePath)) {
        log(`📎 [UI Step ${step}] Detected Resume Upload section. Attaching "${resumeName}"...`);
        const fileLocators = await activePage.locator('input[type="file"]').all();
        for (const fl of fileLocators) {
          await fl.setInputFiles(resumePath).catch(() => {});
        }
        resumeUploaded = true;
        await randomSleep(2000, 3500);
      }

      // --- DECISION 6: CANDIDATE APPLICATION FORM FILLING ---
      if (ui.formInputs.length > 0 || ui.dropdowns.length > 0) {
        log(`📝 [UI Step ${step}] Detected Candidate Application Form (${ui.formInputs.length} inputs, ${ui.dropdowns.length} dropdowns).`);
        log(`   Filling candidate profile (Notice: 15 Days, 2.8+ YOE, SOLIZE, Skills)...`);
        await fillCandidateFormFields(activePage, profile, log);
        await randomSleep(1500, 2500);
      }

      // --- DECISION 7: SUBMISSION OR ADVANCING TO NEXT STEP ---
      // Re-read UI after form filling
      const postFormUI = await readUIState(activePage);

      if (postFormUI.submitButtons.length > 0) {
        const subBtn = postFormUI.submitButtons[0];
        log(`🚀 [UI Step ${step}] Detected Final Submission Button: "${subBtn.text || 'Submit Application'}".`);
        log(`   Clicking Submit Application...`);
        await activePage.locator(`[data-bot-target="${subBtn.targetId}"]`).first().click({ force: true }).catch(() => {});
        await randomSleep(4000, 6000);

        // Check if confirmation appeared
        const finalCheck = await readUIState(activePage);
        if (finalCheck.isConfirmation) {
          log(`🎉 [SUCCESS] Application confirmed submitted to ${curCompanyName || 'Employer'}!`);
          recordApplication({
            company: curCompanyName || 'Company',
            title: curJobTitle || 'Engineering Role',
            url: jobUrl,
            platform: 'PORTAL_DIRECT',
            status: 'SUBMITTED',
            notes: 'Submitted via UI-First Auto-Applier'
          });
          return {
            success: true,
            status: 'SUBMITTED',
            message: `Application submitted to ${curCompanyName || 'Employer'}!`
          };
        } else {
          // Check for Captcha / Bot Challenge (iframes or image text captcha)
          const hasCaptcha = await activePage.evaluate(() => {
            const iframes = Array.from(document.querySelectorAll('iframe'));
            const iframeCaptcha = iframes.some(f => /recaptcha|hcaptcha|challenges\.cloudflare/i.test(f.src || ''));
            const imageCaptcha = document.querySelector('input[placeholder*="image text"], input[placeholder*="captcha"], .cw-captcha, #captcha') !== null;
            return iframeCaptcha || imageCaptcha;
          }).catch(() => false);

          if (hasCaptcha) {
            log(`🛡️ [Bot Protection] Security Captcha challenge detected (Google reCAPTCHA / Cloudflare / Image Text).`);
            log(`   All candidate fields and resume have been prefilled.`);
            log(`💡 Tip: Click "👁️ Show Live Browser Window" in the dashboard to solve captcha with 1 click, or submit in your browser.`);
          }

          // Check for Form Validation Errors
          const validationErrors = await activePage.evaluate(() => {
            const errs = Array.from(document.querySelectorAll('[role="alert"], [aria-invalid="true"], .field-error, span[class*="error"], p[class*="error"]'))
              .filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && el.innerText.trim().length > 0;
              })
              .map(el => el.innerText.trim());
            return [...new Set(errs)];
          }).catch(() => []);

          if (validationErrors.length > 0) {
            log(`⚠️ [Form Validation Notice]: ${validationErrors.slice(0, 3).join(' | ')}`);
          }

          log(`ℹ️ [PREFILLED] Candidate details and resume entered for ${curCompanyName || 'Employer'}.`);
          log(`🏁 [Execution Complete] Job applier finished. Engine returned to Idle.`);
          return {
            success: true,
            status: 'PREFILLED',
            message: `Candidate fields prefilled for ${curCompanyName || 'Employer'}.`
          };
        }
      }

      if (postFormUI.nextStepButtons.length > 0) {
        const nextBtn = postFormUI.nextStepButtons[0];
        log(`➡️ [UI Step ${step}] Detected Next Wizard Step: "${nextBtn.text}". Advancing...`);
        await activePage.locator(`[data-bot-target="${nextBtn.targetId}"]`).first().click({ force: true }).catch(() => {});
        await randomSleep(3000, 4500);
        continue;
      }

      // Fallback: If no action was taken and same URL repeated 2 times
      if (sameUrlCount >= 2) {
        const hasCaptcha = await activePage.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll('iframe'));
          const iframeCaptcha = iframes.some(f => /recaptcha|hcaptcha|challenges\.cloudflare/i.test(f.src || ''));
          const imageCaptcha = document.querySelector('input[placeholder*="image text"], input[placeholder*="captcha"], .cw-captcha, #captcha') !== null;
          return iframeCaptcha || imageCaptcha;
        }).catch(() => false);

        if (hasCaptcha) {
          log(`🛡️ [Bot Protection] Security Captcha challenge detected on page.`);
          log(`   Candidate details and resume prefilled. Ready for 1-click submission with "Show Live Browser Window".`);
        } else {
          log(`⚠️ [UI Step ${step}] Screen unchanged after evaluation. Form pre-fill completed.`);
        }

        return {
          success: true,
          status: 'PREFILLED',
          message: `Candidate fields evaluated and prefilled for ${curCompanyName || 'Employer'}.`
        };
      }

      await randomSleep(1500, 2500);
    }

    log(`🏁 [Complete] Reached maximum evaluation steps. Application processing concluded.`);
    return {
      success: true,
      status: 'PREFILLED',
      message: `Candidate fields processed for ${curCompanyName || 'Employer'}.`
    };

  } catch (err) {
    log(`❌ [UI Applier Error]: ${err.message}`);
    return { success: false, status: 'ERROR', error: err.message };
  } finally {
    await browser.close().catch(() => {});
  }
}
