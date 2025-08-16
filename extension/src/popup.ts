const BACKEND_URL = "http://127.0.0.1:8000";

let extractedProfile: any = null;

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab");
  return tab;
}

function setStatus(msg: string, type: 'loading' | 'success' | 'error' = 'loading') {
  const el = document.getElementById("status")!;
  el.textContent = msg;
  el.className = `status ${type}`;
  el.classList.remove('hidden');
}

function hideStatus() {
  const el = document.getElementById("status")!;
  el.classList.add('hidden');
}

function showSection(sectionId: string) {
  document.getElementById(sectionId)!.classList.remove('hidden');
}

function hideSection(sectionId: string) {
  document.getElementById(sectionId)!.classList.add('hidden');
}

function setButtonLoading(buttonId: string, loading: boolean, originalText?: string) {
  const btn = document.getElementById(buttonId) as HTMLButtonElement;
  if (loading) {
    btn.disabled = true;
    btn.setAttribute('data-original-text', btn.textContent || '');
    btn.textContent = '⏳ Loading...';
    btn.style.opacity = '0.7';
  } else {
    btn.disabled = false;
    btn.textContent = originalText || btn.getAttribute('data-original-text') || btn.textContent;
    btn.style.opacity = '1';
  }
}

// Extract LinkedIn HTML content for LLM parsing
function extractLinkedInProfile(): any {
  console.log('🔍 Starting comprehensive LinkedIn profile extraction...');
  
  // Comprehensive scrolling to trigger LinkedIn's lazy loading
  function scrollAndWait(delay: number = 1000): Promise<void> {
    return new Promise(resolve => {
      // Scroll to different positions to trigger content loading
      const positions = [0, 0.25, 0.5, 0.75, 1.0];
      let currentPosition = 0;
      
      const scrollStep = () => {
        if (currentPosition < positions.length) {
          const scrollY = document.body.scrollHeight * positions[currentPosition];
          window.scrollTo(0, scrollY);
          console.log(`📜 Scrolling to position ${positions[currentPosition] * 100}%`);
          currentPosition++;
          setTimeout(scrollStep, delay / positions.length);
        } else {
          // Final scroll to top
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
        }
      };
      
      scrollStep();
    });
  }
  
  // Note: Removed button clicking functionality - only extract visible text as-is
  
  // Extract visible text content
  function getVisibleText(element: Element): string {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          // Skip hidden elements, scripts, styles, etc.
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || 
              style.visibility === 'hidden' || 
              style.opacity === '0' ||
              parent.tagName === 'SCRIPT' || 
              parent.tagName === 'STYLE' ||
              parent.tagName === 'NOSCRIPT') {
            return NodeFilter.FILTER_REJECT;
          }
          
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    
    let textContent = '';
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text && text.length > 1) {
        textContent += text + ' ';
      }
    }
    
    return textContent.trim();
  }
  
  // Wait for page to be fully loaded and extract visible content
  return new Promise((resolve) => {
    setTimeout(async () => {
      console.log('⏳ Starting comprehensive extraction process...');
      
      // Step 1: Scroll through entire page to load content
      await scrollAndWait(2000);
      
      // Step 2: Extract from multiple areas and combine (no button clicking)
      const contentSources = [
        // Main content areas
        'main[role="main"]',
        '.scaffold-layout__main',
        '.scaffold-layout-container__content',
        
        // Profile sections
        '.pv-top-card',
        '.pv-profile-section',
        '.artdeco-card',
        
        // Specific sections
        '.pv-about-section',
        '.pv-experience-section', 
        '.pv-education-section',
        '.pv-skill-categories-section',
        '.pv-profile-section--education',
        '.pv-profile-section--experience',
        
        // Modern LinkedIn selectors
        '[data-view-name="profile-component-entity"]',
        '.pvs-list',
        '.pvs-entity'
      ];
      
      let allTextContent = '';
      let extractedSections = 0;
      
      contentSources.forEach((selector, index) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((element, elemIndex) => {
          const visibleText = getVisibleText(element);
          if (visibleText.length > 50) { // Lower threshold to catch more content
            allTextContent += `\n--- Section ${index}-${elemIndex} (${selector}) ---\n`;
            allTextContent += visibleText + '\n';
            extractedSections++;
          }
        });
      });
      
      console.log(`✅ Extracted visible content from ${extractedSections} sections (no button clicking)`);
      console.log(`📏 Total content length: ${allTextContent.length} characters`);
      
      // Fallback: get all visible text from body if we didn't get much
      if (allTextContent.length < 2000) {
        console.log('⚠️ Low content extracted, falling back to full body visible text');
        const bodyElement = document.querySelector('body');
        if (bodyElement) {
          allTextContent = getVisibleText(bodyElement);
        }
      }
      
      // Final fallback
      if (!allTextContent || allTextContent.length < 500) {
        console.log('⚠️ Very low content, using innerText fallback');
        allTextContent = document.body.innerText || document.body.textContent || '';
      }
      
      console.log(`🎯 Final content length: ${allTextContent.length} characters`);
      
      resolve({
        linkedinUrl: window.location.href,
        htmlContent: allTextContent,
        // All other fields will be null - LLM will extract everything
        name: null,
        role: null,
        currentCompany: null,
        companies: [],
        highestDegree: null,
        field: null,
        schools: [],
        location: null
      });
    }, 500); // Initial delay to let page settle
  });
}

async function extractProfile(): Promise<any> {
  if (extractedProfile) return extractedProfile;
  
  const tab = await getActiveTab();
  if (!tab.url?.includes("linkedin.com")) {
    throw new Error("Please navigate to a LinkedIn profile page");
  }
  
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: extractLinkedInProfile,
  });
  
  // The function now returns a Promise, so we need to await it
  extractedProfile = await result.result;
  return extractedProfile;
}

async function handleAddToNotion() {
  const buttonId = "addToNotionBtn";
  
  try {
    setButtonLoading(buttonId, true);
    setStatus("Extracting profile information...", 'loading');
    
    const profile = await extractProfile();
    console.log("Extracted profile:", profile);
    
    // Skip name validation since LLM will extract it from HTML
    if (!profile.htmlContent) {
      throw new Error("Could not extract page content. Make sure you're on a LinkedIn profile page.");
    }
    
    const linkedinReached = (document.getElementById("linkedinReached") as HTMLInputElement).checked;
    const emailReached = (document.getElementById("emailReached") as HTMLInputElement).checked;
    
    let linkedinMessage = null;
    let emailMessage = null;
    
    if (linkedinReached) {
      linkedinMessage = "Reached out - no message specified";
    }
    if (emailReached) {
      emailMessage = "Reached out - no message specified";
    }
    
    setStatus("Saving to Notion database...", 'loading');
    
    const payload = {
      profile,
      ask: "Add to Notion",
      options: {
        saveDraftToNotion: true,
        linkedinMessage,
        emailMessage,
      },
    };
    
    const response = await fetch(`${BACKEND_URL}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(`Server error: ${errorData.detail || response.statusText}`);
    }
    
    const data = await response.json();
    console.log("Backend response:", data);
    
    // Show Notion result using data from backend response
    const notionContent = document.getElementById("notionContent")!;
    const savedFields = data.notion?.savedFields || {};
    notionContent.innerHTML = `
      <p><strong>${savedFields.name || 'Profile'}</strong> saved successfully!</p>
      <p>📍 ${savedFields.location || 'Location not found'}</p>
      <p>💼 ${savedFields.role || 'Role not found'} ${savedFields.currentCompany ? `at ${savedFields.currentCompany}` : ''}</p>
      ${data.notion?.url ? `<a href="${data.notion.url}" target="_blank" class="notion-link">🔗 Open in Notion</a>` : ''}
    `;
    
    showSection("notionResult");
            setStatus("Successfully saved to Notion!", 'success');
        
        // Show success feedback on button
        setButtonLoading(buttonId, false, "Saved!");
    setTimeout(() => {
      const btn = document.getElementById(buttonId) as HTMLButtonElement;
      btn.textContent = "Add Profile to Notion";
    }, 2000);
    
    setTimeout(hideStatus, 4000);
    
      } catch (error) {
      console.error("Add to Notion error:", error);
      setStatus(`Error: ${error}`, 'error');
      setButtonLoading(buttonId, false);
    }
}

async function handleGenerateMessage(type: 'linkedin' | 'email') {
  const buttonId = type === 'linkedin' ? 'generateLinkedInDraftBtn' : 'generateEmailDraftBtn';
  
  try {
    setButtonLoading(buttonId, true);
    setStatus("Extracting profile information...", 'loading');
    
    const profile = await extractProfile();
    
    // Skip name validation since LLM will extract it from HTML
    if (!profile.htmlContent) {
      throw new Error("Could not extract page content. Make sure you're on a LinkedIn profile page.");
    }
    
    const askTextarea = document.getElementById(type === 'linkedin' ? 'linkedinAsk' : 'emailAsk') as HTMLTextAreaElement;
    const ask = askTextarea.value.trim();
    
    if (!ask) {
      throw new Error("Please enter your request or select a quick option");
    }
    
    setStatus(`Generating ${type} message with AI...`, 'loading');
    
    const payload = {
      profile,
      ask,
      options: {
        saveDraftToNotion: false,
        messageType: type,
      },
    };
    
    const response = await fetch(`${BACKEND_URL}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
    
    // Check if Notion entry was updated
    if (data.notion && data.notion.savedFields?.updated_with_message) {
      setStatus(`${type === 'linkedin' ? 'LinkedIn' : 'Email'} message generated and Notion entry updated!`, 'success');
    }
    
    // Show draft result
    const subjectSection = document.getElementById("subjectSection")!;
    const draftSubject = document.getElementById("draftSubject") as HTMLInputElement;
    const draftBody = document.getElementById("draftBody") as HTMLTextAreaElement;
    
    if (type === 'email' && data.draft.subject) {
      subjectSection.classList.remove('hidden');
      draftSubject.value = data.draft.subject;
    } else {
      subjectSection.classList.add('hidden');
    }
    
    draftBody.value = data.draft.body;
    
    showSection("draftResult");
    
    // Only show the basic success message if we didn't already show the Notion update message
    if (!(data.notion && data.notion.savedFields?.updated_with_message)) {
      setStatus(`${type === 'linkedin' ? 'LinkedIn' : 'Email'} message generated successfully!`, 'success');
    }
    
    // Show success feedback on button
    setButtonLoading(buttonId, false, "Generated!");
    setTimeout(() => {
      const btn = document.getElementById(buttonId) as HTMLButtonElement;
      btn.textContent = type === 'linkedin' ? "Generate LinkedIn Draft" : "Generate Email Draft";
    }, 2000);
    
    setTimeout(hideStatus, 4000);
    
  } catch (error) {
    console.error("Generate message error:", error);
    setStatus(`Error: ${error}`, 'error');
    setButtonLoading(buttonId, false);
  }
}

function copyDraft() {
  const subjectEl = document.getElementById("draftSubject") as HTMLInputElement;
  const bodyEl = document.getElementById("draftBody") as HTMLTextAreaElement;
  
  let fullText = bodyEl.value;
  if (!document.getElementById("subjectSection")!.classList.contains('hidden')) {
    fullText = `Subject: ${subjectEl.value}\n\n${bodyEl.value}`;
  }
  
      navigator.clipboard.writeText(fullText).then(() => {
      const btn = document.getElementById("copyBtn") as HTMLButtonElement;
      const originalText = btn.textContent;
      btn.textContent = "Copied!";
      btn.style.background = "#059669";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = "#10b981";
      }, 2000);
    }).catch(() => {
      setStatus("Failed to copy to clipboard", 'error');
    });
}

function setupQuickOptions() {
  document.querySelectorAll('.quick-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const ask = target.getAttribute('data-ask');
      const isLinkedin = target.closest('#linkedinMessageSection');
      const textarea = document.getElementById(isLinkedin ? 'linkedinAsk' : 'emailAsk') as HTMLTextAreaElement;
      textarea.value = ask || '';
      
      // Visual feedback
      target.style.background = "#e5e7eb";
      setTimeout(() => {
        target.style.background = "white";
      }, 200);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Add to Notion
  document.getElementById("addToNotionBtn")?.addEventListener("click", handleAddToNotion);
  
  // Message type selection
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
  
  // Back buttons
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
  
  // Generate drafts
  document.getElementById("generateLinkedInDraftBtn")?.addEventListener("click", () => handleGenerateMessage('linkedin'));
  document.getElementById("generateEmailDraftBtn")?.addEventListener("click", () => handleGenerateMessage('email'));
  
  // Copy functionality
  document.getElementById("copyBtn")?.addEventListener("click", copyDraft);
  
  // Setup quick options
  setupQuickOptions();
}); 