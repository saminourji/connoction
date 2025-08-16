"use strict";
(() => {
  // src/content.ts
  var BACKEND_URL = "http://127.0.0.1:8000";
  async function makeBackendRequest(endpoint, data) {
    try {
      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(data),
        mode: "cors"
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(`Server error: ${errorData.detail || response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Cannot connect to backend. Make sure the backend server is running at http://127.0.0.1:8000");
      }
      throw error;
    }
  }
  var extractedProfile = null;
  var floatingPanel = null;
  function createFloatingPanel() {
    return `
    <div id="connoction-floating-panel" class="collapsed">
      <div class="panel-content">
        <div class="glass-container">
          <div class="header">
            <h1>Connoction</h1>
            <button class="collapse-btn" id="collapseBtn">\u2212</button>
          </div>
          
          <div id="status" class="status hidden"></div>
          
          <!-- Add to Notion -->
          <div class="section">
            <div class="section-title">Save Profile</div>
            <div class="glass-panel">
              <div class="checkbox-group">
                <div class="checkbox-item">
                  <input type="checkbox" id="linkedinReached">
                  <label for="linkedinReached">LinkedIn - Already reached out</label>
                </div>
                <div class="checkbox-item">
                  <input type="checkbox" id="emailReached">
                  <label for="emailReached">Email - Already reached out</label>
                </div>
              </div>
              <button id="addToNotionBtn" class="btn-primary">Add to Notion</button>
            </div>
            </div>
          
          <!-- Generate Message -->
          <div class="section">
            <div class="section-title">Generate Message</div>
            <div class="glass-panel">
              <div id="messageTypeSection">
                <button id="generateLinkedInBtn" class="btn-secondary">LinkedIn Message</button>
                <button id="generateEmailBtn" class="btn-secondary">Email Message</button>
              </div>
            
            <!-- LinkedIn Message Generation -->
            <div id="linkedinMessageSection" class="hidden">
              <div class="section-header">
                <button id="backFromLinkedInBtn" class="btn-back">\u2190 Back</button>
                <h3>LinkedIn Message</h3>
              </div>
              <div class="quick-options">
                <button class="quick-option" data-ask="Request to chat for 15 mins">15min chat</button>
                <button class="quick-option" data-ask="Request to chat for 20 mins">20min chat</button>
                <button class="quick-option" data-ask="Request to review resume">Resume review</button>
                <button class="quick-option" data-ask="Request for career advice">Career advice</button>
              </div>
              <textarea id="linkedinAsk" placeholder="Or enter custom request..."></textarea>
              <button id="generateLinkedInDraftBtn" class="btn-primary">Generate Draft</button>
            </div>
            
            <!-- Email Message Generation -->
            <div id="emailMessageSection" class="hidden">
              <div class="section-header">
                <button id="backFromEmailBtn" class="btn-back">\u2190 Back</button>
                <h3>Email Message</h3>
              </div>
              <div class="quick-options">
                <button class="quick-option" data-ask="Request to chat for 15 mins">15min chat</button>
                <button class="quick-option" data-ask="Request to chat for 20 mins">20min chat</button>
                <button class="quick-option" data-ask="Request to review resume">Resume review</button>
                <button class="quick-option" data-ask="Request for career advice">Career advice</button>
              </div>
              <textarea id="emailAsk" placeholder="Or enter custom request..."></textarea>
              <button id="generateEmailDraftBtn" class="btn-primary">Generate Draft</button>
            </div>
          </div>
        </div>
        
        <!-- Results -->
        <div id="notionResult" class="section hidden">
          <div class="section-title">Saved to Notion</div>
          <div class="glass-panel">
            <div id="notionContent" class="profile-info"></div>
          </div>
        </div>
        
        <div id="draftResult" class="section hidden">
          <div class="section-title">Generated Message</div>
          <div class="glass-panel">
            <div class="draft-result">
              <div id="subjectSection" class="hidden">
                <label>Subject</label>
                <input id="draftSubject" type="text" readonly />
              </div>
              <label>Message</label>
              <textarea id="draftBody" readonly rows="6"></textarea>
              <button id="copyBtn" class="btn-primary">Copy to Clipboard</button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  `;
  }
  function setStatus(message, type) {
    const statusEl = document.getElementById("status");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.classList.remove("hidden");
  }
  function hideStatus() {
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.classList.add("hidden");
    }
  }
  function showSection(sectionId) {
    const sections = ["messageTypeSection", "linkedinMessageSection", "emailMessageSection", "notionResult", "draftResult"];
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    const section = document.getElementById(sectionId);
    if (section) section.classList.remove("hidden");
  }
  function setButtonLoading(buttonId, loading, originalText) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.textContent = "Loading...";
      btn.style.opacity = "0.7";
    } else {
      btn.disabled = false;
      btn.textContent = originalText || btn.textContent;
      btn.style.opacity = "1";
    }
  }
  function extractLinkedInProfile() {
    const profile = {};
    profile.linkedinUrl = window.location.href;
    const nameEl = document.querySelector('h1.inline.t-24.v-align-middle.break-words, h1[class*="inline"][class*="t-24"]');
    profile.name = nameEl?.textContent?.trim() || null;
    const experienceItems = document.querySelectorAll('[data-view-name="profile-component-entity"]');
    const companies = [];
    experienceItems.forEach((item, index) => {
      const titleElement = item.querySelector('.t-bold span[aria-hidden="true"]');
      const companyElement = item.querySelector('.t-14.t-normal span[aria-hidden="true"]');
      if (titleElement && companyElement) {
        const title = titleElement.textContent?.trim();
        const company = companyElement.textContent?.trim();
        if (index === 0 && title) {
          profile.role = title;
        }
        if (company && !company.includes("University") && !company.includes("School") && !company.includes("College") && !companies.includes(company)) {
          companies.push(company);
        }
      }
    });
    profile.companies = companies;
    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words, span[class*="text-body-small"][class*="t-black--light"]');
    profile.location = locationEl?.textContent?.trim() || null;
    profile.currentCompany = companies.length > 0 ? companies[0] : null;
    profile.schools = [];
    const degrees = [];
    const fields = [];
    const educationSection = document.querySelector("#education");
    let educationItems = [];
    if (educationSection) {
      educationItems = educationSection.querySelectorAll('[data-view-name="profile-component-entity"]');
    } else {
      educationItems = Array.from(document.querySelectorAll('[data-view-name="profile-component-entity"]')).filter((item) => {
        const schoolElement = item.querySelector('.t-bold span[aria-hidden="true"]');
        const school = schoolElement?.textContent?.trim();
        return school && (school.includes("University") || school.includes("School") || school.includes("College") || school.includes("Institute"));
      });
    }
    educationItems.forEach((item) => {
      const schoolElement = item.querySelector('.t-bold span[aria-hidden="true"]');
      const degreeElement = item.querySelector('.t-14.t-normal span[aria-hidden="true"]');
      const school = schoolElement?.textContent?.trim();
      const degreeText = degreeElement?.textContent?.trim();
      if (school && !profile.schools.includes(school)) {
        profile.schools.push(school);
      }
      if (degreeText) {
        if (degreeText.includes("PhD") || degreeText.includes("Doctor")) {
          degrees.push("PhD");
        } else if (degreeText.includes("Master") || degreeText.includes("MS") || degreeText.includes("MA") || degreeText.includes("MBA")) {
          degrees.push("Master's");
        } else if (degreeText.includes("Bachelor") || degreeText.includes("BS") || degreeText.includes("BA") || degreeText.includes("BEng")) {
          degrees.push("Bachelor's");
        }
        const fieldKeywords = {
          "PM": ["product management", "business", "management", "economics"],
          "SWE": ["computer science", "software", "engineering", "cs", "computer engineering"],
          "AI SWE": ["artificial intelligence", "machine learning", "ai", "ml", "data science"],
          "MLE": ["machine learning", "data science", "statistics", "ai", "ml"],
          "Research": ["research", "phd", "science", "physics", "chemistry", "biology", "mathematics"]
        };
        const lowerDegreeText = degreeText.toLowerCase();
        for (const [field, keywords] of Object.entries(fieldKeywords)) {
          if (keywords.some((keyword) => lowerDegreeText.includes(keyword))) {
            if (!fields.includes(field)) {
              fields.push(field);
            }
          }
        }
      }
    });
    if (degrees.length > 0) {
      const degreeHierarchy = ["PhD", "Master's", "Bachelor's"];
      profile.highestDegree = degreeHierarchy.find((degree) => degrees.includes(degree)) || degrees[0];
    }
    profile.field = fields;
    return profile;
  }
  async function extractProfile() {
    if (extractedProfile) return extractedProfile;
    if (!window.location.href.includes("linkedin.com")) {
      throw new Error("Please navigate to a LinkedIn profile page");
    }
    extractedProfile = extractLinkedInProfile();
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
      setStatus("Saving to Notion...", "loading");
      const linkedinMessage = linkedinReached ? "Contacted via LinkedIn" : null;
      const emailMessage = emailReached ? "Contacted via Email" : null;
      const payload = {
        profile,
        ask: "",
        options: {
          saveDraftToNotion: true,
          linkedinMessage,
          emailMessage
        }
      };
      const data = await makeBackendRequest("/draft", payload);
      console.log("Backend response:", data);
      const notionContent = document.getElementById("notionContent");
      notionContent.innerHTML = `
      <p><strong>${profile.name}</strong> saved successfully!</p>
      <p>${profile.location || "Location not found"}</p>
      <p>${profile.role || "Role not found"} ${profile.currentCompany ? `at ${profile.currentCompany}` : ""}</p>
      ${data.notion?.url ? `<a href="${data.notion.url}" target="_blank" class="notion-link">Open in Notion</a>` : ""}
    `;
      showSection("notionResult");
      setStatus("Successfully saved to Notion!", "success");
      setButtonLoading(buttonId, false, "Saved!");
      setTimeout(() => {
        const btn = document.getElementById(buttonId);
        if (btn) btn.textContent = "Add Profile to Notion";
      }, 2e3);
      setTimeout(hideStatus, 4e3);
    } catch (error) {
      console.error("Add to Notion error:", error);
      setStatus(`Error: ${error}`, "error");
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
      const data = await makeBackendRequest("/draft", payload);
      console.log("Backend response:", data);
      if (!data.draft) {
        throw new Error("No draft generated. Make sure OpenAI is configured in your .env file.");
      }
      if (data.notion && data.notion.savedFields?.updated_with_message) {
        setStatus(`${type === "linkedin" ? "LinkedIn" : "Email"} message generated and Notion entry updated!`, "success");
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
      if (!(data.notion && data.notion.savedFields?.updated_with_message)) {
        setStatus(`${type === "linkedin" ? "LinkedIn" : "Email"} message generated successfully!`, "success");
      }
      setButtonLoading(buttonId, false, "Generated!");
      setTimeout(() => {
        const btn = document.getElementById(buttonId);
        if (btn) btn.textContent = type === "linkedin" ? "Generate LinkedIn Draft" : "Generate Email Draft";
      }, 2e3);
      setTimeout(hideStatus, 4e3);
    } catch (error) {
      console.error("Generate message error:", error);
      setStatus(`Error: ${error}`, "error");
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
      btn.textContent = "Copied!";
      btn.style.background = "#059669";
      setTimeout(() => {
        if (btn && originalText) {
          btn.textContent = originalText;
          btn.style.background = "#10b981";
        }
      }, 2e3);
    }).catch(() => {
      setStatus("Failed to copy to clipboard", "error");
    });
  }
  function setupQuickOptions() {
    document.querySelectorAll(".quick-option").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.target;
        const ask = target.getAttribute("data-ask");
        const isLinkedin = target.closest("#linkedinMessageSection");
        const textarea = document.getElementById(isLinkedin ? "linkedinAsk" : "emailAsk");
        if (textarea && ask) {
          textarea.value = ask;
          target.style.background = "#e5e7eb";
          setTimeout(() => {
            target.style.background = "white";
          }, 200);
        }
      });
    });
  }
  function initializeFloatingPanel() {
    if (!window.location.href.includes("linkedin.com")) {
      return;
    }
    if (document.getElementById("connoction-floating-panel")) {
      return;
    }
    const panelHTML = createFloatingPanel();
    document.body.insertAdjacentHTML("beforeend", panelHTML);
    floatingPanel = document.getElementById("connoction-floating-panel");
    if (!floatingPanel) return;
    setupEventListeners();
    setupQuickOptions();
  }
  function setupEventListeners() {
    const collapseBtn = document.getElementById("collapseBtn");
    const panel = document.getElementById("connoction-floating-panel");
    if (collapseBtn && panel) {
      collapseBtn.addEventListener("click", () => {
        panel.classList.toggle("collapsed");
        collapseBtn.textContent = panel.classList.contains("collapsed") ? "+" : "\u2212";
      });
      panel.addEventListener("click", (e) => {
        if (panel.classList.contains("collapsed") && e.target === panel) {
          panel.classList.remove("collapsed");
          collapseBtn.textContent = "\u2212";
        }
      });
      let isDragging = false;
      let dragStartY = 0;
      let panelStartY = 0;
      panel.addEventListener("mousedown", (e) => {
        const header = panel.querySelector(".header");
        const isHeader = header?.contains(e.target);
        const isCollapsed = panel.classList.contains("collapsed");
        if (isHeader || isCollapsed) {
          isDragging = true;
          dragStartY = e.clientY;
          panelStartY = panel.offsetTop;
          panel.classList.add("dragging");
          e.preventDefault();
        }
      });
      document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const deltaY = e.clientY - dragStartY;
        let newY = panelStartY + deltaY;
        const maxY = window.innerHeight - panel.offsetHeight;
        newY = Math.max(0, Math.min(newY, maxY));
        panel.style.top = `${newY}px`;
        panel.style.transform = "translateY(0)";
      });
      document.addEventListener("mouseup", () => {
        if (isDragging) {
          isDragging = false;
          panel.classList.remove("dragging");
        }
      });
    }
    document.getElementById("generateLinkedInBtn")?.addEventListener("click", () => {
      showSection("linkedinMessageSection");
    });
    document.getElementById("generateEmailBtn")?.addEventListener("click", () => {
      showSection("emailMessageSection");
    });
    document.getElementById("backFromLinkedInBtn")?.addEventListener("click", () => {
      showSection("messageTypeSection");
    });
    document.getElementById("backFromEmailBtn")?.addEventListener("click", () => {
      showSection("messageTypeSection");
    });
    document.getElementById("addToNotionBtn")?.addEventListener("click", handleAddToNotion);
    document.getElementById("generateLinkedInDraftBtn")?.addEventListener("click", () => handleGenerateMessage("linkedin"));
    document.getElementById("generateEmailDraftBtn")?.addEventListener("click", () => handleGenerateMessage("email"));
    document.getElementById("copyBtn")?.addEventListener("click", copyDraft);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeFloatingPanel);
  } else {
    initializeFloatingPanel();
  }
  var currentUrl = window.location.href;
  var observer = new MutationObserver(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      extractedProfile = null;
      setTimeout(initializeFloatingPanel, 1e3);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
//# sourceMappingURL=content.js.map
