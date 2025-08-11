"use strict";
(() => {
  // src/popup.ts
  var BACKEND_URL = "http://127.0.0.1:8000";
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab");
    return tab;
  }
  function setStatus(msg) {
    const el = document.getElementById("status");
    if (el) el.textContent = msg;
  }
  function showResult(notionText, draft) {
    const wrap = document.getElementById("result");
    wrap.style.display = "block";
    const notion = document.getElementById("notion");
    notion.textContent = notionText;
    const draftWrap = document.getElementById("draftWrap");
    if (draft) {
      draftWrap.style.display = "block";
      document.getElementById("subject").textContent = draft.subject;
      document.getElementById("body").textContent = draft.body;
    } else {
      draftWrap.style.display = "none";
    }
  }
  async function onExtract() {
    setStatus("Extracting visible profile...");
    const ask = document.getElementById("ask").value.trim();
    const destination = document.getElementById("destination").value;
    const tab = await getActiveTab();
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        function text(el) {
          return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : null;
        }
        const name = text(document.querySelector("main h1"));
        let location = null;
        const nameEl = document.querySelector("main h1");
        if (nameEl) {
          const container = nameEl.closest("section, div");
          if (container) {
            const locCand = container.querySelector('span[class*="text-body-small"], div[class*="text-body-small"]');
            location = text(locCand);
          }
        }
        if (!location) {
          const locCand = document.querySelector('span[class*="text-body-small"], div[class*="text-body-small"]');
          location = text(locCand);
        }
        function extractExperiences() {
          const items = [];
          const anchors = Array.from(document.querySelectorAll('a[href*="add-edit/POSITION"], a[data-field="experience_company_logo"]'));
          for (const a of anchors.slice(0, 10)) {
            const card = a.closest('[data-view-name="profile-component-entity"], li, div');
            if (!card) continue;
            const titleEl = card.querySelector('.t-bold span[aria-hidden="true"], .t-bold, strong');
            const title = text(titleEl);
            const companyEl = card.querySelector('.t-14.t-normal span[aria-hidden="true"], .t-14.t-normal');
            let company = text(companyEl);
            if (company && company.includes(" \xB7 ")) company = company.split(" \xB7 ")[0].trim();
            const dateEl = card.querySelector('.pvs-entity__caption-wrapper[aria-hidden="true"], .t-black--light .pvs-entity__caption-wrapper, .t-black--light');
            const date = text(dateEl);
            if (title || company) items.push({ title, company, date });
          }
          return items;
        }
        const exps = extractExperiences();
        const current = exps.find((e) => (e.date || "").toLowerCase().includes("present")) || exps[0] || { title: null, company: null };
        function extractEducation() {
          const results = [];
          const anchors = Array.from(document.querySelectorAll('a[href*="add-edit/EDUCATION"]'));
          for (const a of anchors.slice(0, 5)) {
            const card = a.closest('[data-view-name="profile-component-entity"], li, div');
            if (!card) continue;
            const schoolEl = card.querySelector('.t-bold span[aria-hidden="true"], .t-bold');
            const degreeEl = card.querySelector('.t-14.t-normal span[aria-hidden="true"], .t-14.t-normal');
            const school = text(schoolEl);
            const degree = text(degreeEl);
            results.push({ school, degree });
          }
          return results;
        }
        const edus = extractEducation();
        const schools = edus.map((e) => e.school).filter(Boolean);
        const degrees = edus.map((e) => e.degree).filter(Boolean);
        const role = current.title || null;
        const currentCompany = current.company || null;
        return { name, location, role, currentCompany, schools, degrees };
      }
    });
    const profile = {
      name: result?.name || null,
      role: result?.role || null,
      currentCompany: result?.currentCompany || null,
      highestDegree: result?.degrees && result.degrees[0] || null,
      field: null,
      schools: (result?.schools || []).slice(0, 3),
      location: result?.location || null,
      linkedinUrl: tab.url || void 0
    };
    setStatus("Saving to Notion...");
    const resp = await fetch(`${BACKEND_URL}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile,
        ask,
        options: {
          saveDraftToNotion: Boolean(destination),
          draftDestination: destination || null
        }
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      setStatus(`Error: ${resp.status} ${err}`);
      return;
    }
    const data = await resp.json();
    setStatus("");
    showResult(data?.notion?.url || data?.notion?.pageId || "Saved", data.draft);
  }
  function onCopy() {
    const subject = document.getElementById("subject").textContent || "";
    const body = document.getElementById("body").textContent || "";
    const text = subject ? `Subject: ${subject}

${body}` : body;
    navigator.clipboard.writeText(text);
  }
  document.getElementById("extract").addEventListener("click", () => {
    onExtract().catch((err) => setStatus(String(err)));
  });
  document.getElementById("copy").addEventListener("click", onCopy);
})();
//# sourceMappingURL=popup.js.map
