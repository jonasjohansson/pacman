# Game Logic Refactor Implementation Plan

## Summary of Required Changes

### 1. Game Always Running ✅
- Set `gameStarted: true` by default
- Remove start button requirement
- All characters move continuously

### 2. Player Initials System
- Add 3-letter initials input when joining
- Validate and sanitize input
- Store in player object
- Display next to character

### 3. Round System (30 seconds OR capture)
- Round = 30 seconds OR being caught (whichever comes first)
- Track round start time
- End round after 30 seconds or capture
- Increment rounds counter

### 4. New Scoring System
- **Chaser**: Score = total time to catch chasee (lower is better)
- **Chasee**: Score = evasion + items collected
- Track capture times
- Track items collected per round

### 5. Collectible Items
- Add items to map (dots/pellets)
- Chasees collect items by moving over them
- Items respawn after collection
- Track items collected per player

### 6. Human/AI Indicator
- Show "H" or "AI" next to character avatars
- Update when player joins/leaves

### 7. Queue System
- After 10 rounds, player enters queue
- Manual "Join Queue" button
- Wait for available slot
- Re-enter game when slot opens

## Implementation Status

- [x] Game always running
- [ ] Initials input system
- [ ] Round system (30s OR capture)
- [ ] New scoring system
- [ ] Collectible items
- [ ] Human/AI indicator
- [ ] Queue system

