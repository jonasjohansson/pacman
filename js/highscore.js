// Import shared utilities
import { getHTTPServerAddress } from "./utils.js";

async function loadHighscore() {
  const loadingEl = document.getElementById("loading");
  const contentEl = document.getElementById("highscore-content");
  const noHighscoreEl = document.getElementById("no-highscore");
  
  try {
    const serverAddress = getHTTPServerAddress();
    const response = await fetch(`${serverAddress}/api/highscore`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      // If 404, the endpoint might not be deployed yet
      if (response.status === 404) {
        loadingEl.textContent = "Highscore endpoint not available. Server may need to be updated.";
        return;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    loadingEl.style.display = "none";
    
    // Handle both array and legacy single object format
    const highscores = Array.isArray(data) ? data : (data && data.score !== undefined ? [data] : []);
    
    if (highscores.length > 0) {
      contentEl.style.display = "grid";
      noHighscoreEl.style.display = "none";
      
      // Generate HTML for all scores with enumeration
      contentEl.innerHTML = highscores.map((entry, index) => `
        <div class="highscore-item">
          <div class="rank">${index + 1}</div>
          <div class="score">${entry.score.toLocaleString()}</div>
          <div class="player-name">${entry.playerName || "Unknown"}</div>
          <div class="game-type">${entry.isTeamGame ? "Team Game" : "Solo Game"}</div>
        </div>
      `).join("");
    } else {
      contentEl.style.display = "none";
      noHighscoreEl.style.display = "block";
    }
  } catch (error) {
    console.error("Error loading highscore:", error);
    loadingEl.style.display = "block";
    loadingEl.textContent = `Error loading highscore: ${error.message}. Make sure the server is running and has the latest code deployed.`;
  }
}

// Load highscore on page load
document.addEventListener("DOMContentLoaded", () => {
  loadHighscore();
  
  // Refresh every 5 seconds
  setInterval(loadHighscore, 5000);
});
