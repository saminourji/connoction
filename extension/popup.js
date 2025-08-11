"use strict";
(() => {
  // src/popup.ts
  var BACKEND_URL = "http://127.0.0.1:8000";
  var extractedProfile = null;
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab");
    return tab;
  }
  function setStatus(msg, type = "loading") {
    const el = document.getElementById("status");
    el.textContent = msg;
    el.className = `status ${type}`;
    el.classList.remove("hidden");
  }
  function hideStatus() {
    const el = document.getElementById("status");
    el.classList.add("hidden");
  }
  function showSection(sectionId) {
    document.getElementById(sectionId).classList.remove("hidden");
  }
  function hideSection(sectionId) {
    document.getElementById(sectionId).classList.add("hidden");
  }
  function setButtonLoading(buttonId, loading, originalText) {
    const btn = document.getElementById(buttonId);
    if (loading) {
      btn.disabled = true;
      btn.setAttribute("data-original-text", btn.textContent || "");
      btn.textContent = "\u23F3 Loading...";
      btn.style.opacity = "0.7";
    } else {
      btn.disabled = false;
      btn.textContent = originalText || btn.getAttribute("data-original-text") || btn.textContent;
      btn.style.opacity = "1";
    }
  }
  function extractLinkedInProfile() {
    const profile = {};
    profile.linkedinUrl = window.location.href;
    const nameEl = document.querySelector('h1.inline.t-24.v-align-middle.break-words, h1[class*="inline"][class*="t-24"]');
    profile.name = nameEl?.textContent?.trim() || null;
    const headlineEl = document.querySelector(".text-body-medium.break-words, [data-generated-suggestion-target] .text-body-medium");
    const headline = headlineEl?.textContent?.trim();
    if (headline) {
      const match = headline.match(/^(.+?)\s*@\s*(.+)$/);
      if (match) {
        profile.role = match[1].trim();
        profile.currentCompany = match[2].trim();
      } else {
        profile.role = headline;
      }
    }
    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words, span[class*="text-body-small"][class*="t-black--light"]');
    profile.location = locationEl?.textContent?.trim() || null;
    if (!profile.currentCompany) {
      const firstExpEl = document.querySelector('[data-view-name="profile-component-entity"] .t-bold span[aria-hidden="true"]');
      const companyFromExp = firstExpEl?.textContent?.trim();
      if (companyFromExp && !companyFromExp.includes("University") && !companyFromExp.includes("School")) {
        profile.currentCompany = companyFromExp;
      }
    }
    if (!profile.role) {
      const roleEl = document.querySelector('[data-view-name="profile-component-entity"] .t-bold span[aria-hidden="true"]');
      profile.role = roleEl?.textContent?.trim() || null;
    }
    profile.schools = [];
    const educationEls = document.querySelectorAll('[data-view-name="profile-component-entity"] .t-bold span[aria-hidden="true"]');
    educationEls.forEach((el) => {
      const text = el.textContent?.trim();
      if (text && (text.includes("University") || text.includes("School") || text.includes("College") || text.includes("Institute"))) {
        if (!profile.schools.includes(text)) {
          profile.schools.push(text);
        }
      }
    });
    const degreeTexts = document.querySelectorAll('.t-14.t-normal span[aria-hidden="true"]');
    const degrees = [];
    degreeTexts.forEach((el) => {
      const text = el.textContent?.trim();
      if (text && (text.includes("BS") || text.includes("MS") || text.includes("PhD") || text.includes("Bachelor") || text.includes("Master") || text.includes("Doctor"))) {
        degrees.push(text);
      }
    });
    if (degrees.length > 0) {
      const highestDegree = degrees.find((d) => d.includes("PhD") || d.includes("Doctor")) || degrees.find((d) => d.includes("MS") || d.includes("Master")) || degrees.find((d) => d.includes("BS") || d.includes("Bachelor")) || degrees[0];
      profile.highestDegree = highestDegree;
    }
    return profile;
  }
  async function extractProfile() {
    if (extractedProfile) return extractedProfile;
    const tab = await getActiveTab();
    if (!tab.url?.includes("linkedin.com")) {
      throw new Error("Please navigate to a LinkedIn profile page");
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractLinkedInProfile
    });
    extractedProfile = result.result;
    return extractedProfile;
  }
  async function handleAddToNotion() {
    const buttonId = "addToNotionBtn";
    try {
      setButtonLoading(buttonId, true);
      setStatus("Extracting profile information...", "loading");
      const profile = await extractProfile();
      console.log("Extracted profile:", profile);
      if (!profile.name) {
        throw new Error("Could not extract profile name. Make sure you're on a LinkedIn profile page.");
      }
      const linkedinReached = document.getElementById("linkedinReached").checked;
      const emailReached = document.getElementById("emailReached").checked;
      let linkedinMessage = null;
      let emailMessage = null;
      if (linkedinReached) {
        linkedinMessage = "Reached out - no message specified";
      }
      if (emailReached) {
        emailMessage = "Reached out - no message specified";
      }
      setStatus("Saving to Notion database...", "loading");
      const payload = {
        profile,
        ask: "Add to Notion",
        options: {
          saveDraftToNotion: true,
          linkedinMessage,
          emailMessage
        }
      };
      const response = await fetch(`${BACKEND_URL}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(`Server error: ${errorData.detail || response.statusText}`);
      }
      const data = await response.json();
      console.log("Backend response:", data);
      const notionContent = document.getElementById("notionContent");
      notionContent.innerHTML = `
      <p><strong>${profile.name}</strong> saved successfully!</p>
      <p>\u{1F4CD} ${profile.location || "Location not found"}</p>
      <p>\u{1F4BC} ${profile.role || "Role not found"} ${profile.currentCompany ? `at ${profile.currentCompany}` : ""}</p>
      ${data.notion?.url ? `<a href="${data.notion.url}" target="_blank" class="notion-link">\u{1F517} Open in Notion</a>` : ""}
    `;
      showSection("notionResult");
      setStatus("\u2705 Successfully saved to Notion!", "success");
      setButtonLoading(buttonId, false, "\u2705 Saved!");
      setTimeout(() => {
        const btn = document.getElementById(buttonId);
        btn.textContent = "Add Profile to Notion";
      }, 2e3);
      setTimeout(hideStatus, 4e3);
    } catch (error) {
      console.error("Add to Notion error:", error);
      setStatus(`\u274C Error: ${error}`, "error");
      setButtonLoading(buttonId, false);
    }
  }
  async function handleGenerateMessage(type) {
    const buttonId = type === "linkedin" ? "generateLinkedInDraftBtn" : "generateEmailDraftBtn";
    try {
      setButtonLoading(buttonId, true);
      setStatus("Extracting profile information...", "loading");
      const profile = await extractProfile();
      if (!profile.name) {
        throw new Error("Could not extract profile name. Make sure you're on a LinkedIn profile page.");
      }
      const askTextarea = document.getElementById(type === "linkedin" ? "linkedinAsk" : "emailAsk");
      const ask = askTextarea.value.trim();
      if (!ask) {
        throw new Error("Please enter your request or select a quick option");
      }
      setStatus(`Generating ${type} message with AI...`, "loading");
      const payload = {
        profile,
        ask,
        options: {
          saveDraftToNotion: false,
          messageType: type
        }
      };
      const response = await fetch(`${BACKEND_URL}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(`Server error: ${errorData.detail || response.statusText}`);
      }
      const data = await response.json();
      console.log("Backend response:", data);
      if (!data.draft) {
        throw new Error("No draft generated. Make sure OpenAI is configured in your .env file.");
      }
      const subjectSection = document.getElementById("subjectSection");
      const draftSubject = document.getElementById("draftSubject");
      const draftBody = document.getElementById("draftBody");
      if (type === "email" && data.draft.subject) {
        subjectSection.classList.remove("hidden");
        draftSubject.value = data.draft.subject;
      } else {
        subjectSection.classList.add("hidden");
      }
      draftBody.value = data.draft.body;
      showSection("draftResult");
      setStatus(`\u2705 ${type === "linkedin" ? "LinkedIn" : "Email"} message generated successfully!`, "success");
      setButtonLoading(buttonId, false, "\u2705 Generated!");
      setTimeout(() => {
        const btn = document.getElementById(buttonId);
        btn.textContent = type === "linkedin" ? "Generate LinkedIn Draft" : "Generate Email Draft";
      }, 2e3);
      setTimeout(hideStatus, 4e3);
    } catch (error) {
      console.error("Generate message error:", error);
      setStatus(`\u274C Error: ${error}`, "error");
      setButtonLoading(buttonId, false);
    }
  }
  function copyDraft() {
    const subjectEl = document.getElementById("draftSubject");
    const bodyEl = document.getElementById("draftBody");
    let fullText = bodyEl.value;
    if (!document.getElementById("subjectSection").classList.contains("hidden")) {
      fullText = `Subject: ${subjectEl.value}

${bodyEl.value}`;
    }
    navigator.clipboard.writeText(fullText).then(() => {
      const btn = document.getElementById("copyBtn");
      const originalText = btn.textContent;
      btn.textContent = "\u2705 Copied!";
      btn.style.background = "#059669";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = "#10b981";
      }, 2e3);
    }).catch(() => {
      setStatus("\u274C Failed to copy to clipboard", "error");
    });
  }
  function setupQuickOptions() {
    document.querySelectorAll(".quick-option").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.target;
        const ask = target.getAttribute("data-ask");
        const isLinkedin = target.closest("#linkedinMessageSection");
        const textarea = document.getElementById(isLinkedin ? "linkedinAsk" : "emailAsk");
        textarea.value = ask || "";
        target.style.background = "#e5e7eb";
        setTimeout(() => {
          target.style.background = "white";
        }, 200);
      });
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("addToNotionBtn")?.addEventListener("click", handleAddToNotion);
    document.getElementById("generateLinkedInBtn")?.addEventListener("click", () => {
      hideSection("messageTypeSection");
      hideSection("emailMessageSection");
      showSection("linkedinMessageSection");
    });
    document.getElementById("generateEmailBtn")?.addEventListener("click", () => {
      hideSection("messageTypeSection");
      hideSection("linkedinMessageSection");
      showSection("emailMessageSection");
    });
    document.getElementById("backFromLinkedInBtn")?.addEventListener("click", () => {
      hideSection("linkedinMessageSection");
      hideSection("emailMessageSection");
      showSection("messageTypeSection");
    });
    document.getElementById("backFromEmailBtn")?.addEventListener("click", () => {
      hideSection("linkedinMessageSection");
      hideSection("emailMessageSection");
      showSection("messageTypeSection");
    });
    document.getElementById("generateLinkedInDraftBtn")?.addEventListener("click", () => handleGenerateMessage("linkedin"));
    document.getElementById("generateEmailDraftBtn")?.addEventListener("click", () => handleGenerateMessage("email"));
    document.getElementById("copyBtn")?.addEventListener("click", copyDraft);
    setupQuickOptions();
  });
})();
//# sourceMappingURL=popup.js.map
