import React, { useState, useMemo } from 'react';
import './RulesGlossaryTab.css';

type ChapterId = 'BASICS' | 'ZONES' | 'KEYWORDS' | 'MECHANICS' | 'COMBAT' | 'INDEX';

interface TomeEntry {
  id: string;
  term: string;
  chapter: Exclude<ChapterId, 'INDEX'>;
  badge: string;
  summary: string;
  details: string;
  rulingNote?: string;
  example?: string;
}

const TOME_ENTRIES: TomeEntry[] = [
  // CHAPTER I: BASICS & TURN FLOW
  {
    id: 'deck-construction',
    term: 'Deck Construction & Setup',
    chapter: 'BASICS',
    badge: 'Core Rule',
    summary: '1 Mane Character, 4 Story Stages, 10–15 Scene Cards, and a 50-card Main Deck.',
    details:
      'Before the match begins, place your Mane Character face-up and stack your 4 Story Cards in Stage order (I → IV). Shuffle your Main Deck and place the top 4 cards face-down beneath your 4 Story Stages as secret Plans. Draw 5 cards for your opening Hand (you may take 1 mulligan), then place the top 2 cards of your Scene Deck into your Scene Area.',
    rulingNote:
      'First-Turn Balance: The player who goes first places their 1st Scene card locked face-down for Turn 1, skips their Turn 1 Draw Phase, and skips their Turn 1 Contact Phase.',
  },
  {
    id: 'harmony-cost',
    term: 'Paying Force of Harmony Costs',
    chapter: 'BASICS',
    badge: 'Resource Rule',
    summary: 'Exhaust (tap) Scenes equal to a card’s cost, matching at least 1 Scene of the card’s Element.',
    details:
      'Every Character, Event, and Item displays a Force of Harmony cost in its top-left corner. To play it, exhaust that many untapped Scenes in your Scene Area. At least one exhausted Scene must match the played card’s Element of Harmony (or be an Everyday / Rainbow wild Scene).',
    example:
      'To play a 3-cost Honesty (Orange) Character, you must exhaust 3 untapped Scenes, and at least 1 of them must provide Honesty or Everyday.',
  },
  {
    id: 'victory-conditions',
    term: 'How to Win the Match',
    chapter: 'BASICS',
    badge: 'Victory',
    summary: 'Complete Story Stage IV via Breakthroughs, or win if your Rival decks out.',
    details:
      'Whenever one of your Characters breaks through an uncontested lane during Contact and advances your Story to Stage IV, you immediately win the game! A player also loses immediately if they must draw from an empty Main Deck.',
  },

  // CHAPTER II: CARD TYPES & ZONES
  {
    id: 'adventure-area',
    term: 'Adventure Area & Duplicate Characters',
    chapter: 'ZONES',
    badge: 'Zone Rule',
    summary: '3 Adventure Slots (Left, Center, Right). Multiple copies of the same Character ARE allowed!',
    details:
      'Your Adventure Area has three lanes: Left, Center, and Right, each holding up to 1 Character. You may freely control multiple Characters with the exact same name across your three slots at the same time. If you play a Character into an already-occupied slot, the previous Character in that slot is sent to the Retirement Area (triggering Farewell).',
    rulingNote:
      'Official Ruling: There is NO "unique name" restriction in Kayou MLP TCG. Cards like Camping Buddies explicitly reward having multiple copies of the same pony in play.',
  },
  {
    id: 'items-adorn',
    term: 'Items & Adorn Restrictions',
    chapter: 'ZONES',
    badge: 'Card Type',
    summary: 'Attach an Item to a Character in your Adventure Area to boost Inspiration and grant skills.',
    details:
      'Items must be played onto an existing Character in your Adventure Area. Some Items list an Adorn requirement (such as "Only Adorn 「Twilight Sparkle」" or "Only Adorn 「Unicorn」"). Each Character may hold 1 Item at a time; attaching a new Item sends the old Item to the Retirement Area.',
  },
  {
    id: 'retire-vs-remove',
    term: 'Retire vs. Remove',
    chapter: 'ZONES',
    badge: 'Zone Rule',
    summary: 'Retire sends cards to the Retirement Area (discard pile); Remove banishes them from the game.',
    details:
      'When a Character Retires (in Contact, by effect, or by slot replacement), it and all attached Items/Presents go to your Retirement Area and trigger any Farewell effects. When a card is Removed, it is banished from the match completely and does NOT trigger Farewell.',
  },

  // CHAPTER III: CORE KEYWORDS
  {
    id: 'kw-appear',
    term: 'Appear',
    chapter: 'KEYWORDS',
    badge: 'Trigger Keyword',
    summary: 'Triggers immediately when a Character enters an Adventure Area slot.',
    details:
      'Whenever a Character enters your Adventure Area (from your Hand or via an effect), resolve its Appear ability immediately before taking further Main Phase actions.',
  },
  {
    id: 'kw-farewell',
    term: 'Farewell',
    chapter: 'KEYWORDS',
    badge: 'Trigger Keyword',
    summary: 'Triggers when a Character leaves the Adventure Area to the Retirement Area.',
    details:
      'Activates whenever a Character is Retired during Contact, retired by a spell/ability, or replaced when playing a new Character into the same Adventure slot.',
  },
  {
    id: 'kw-adventure',
    term: 'Adventure',
    chapter: 'KEYWORDS',
    badge: 'Field Keyword',
    summary: 'Abilities or continuous passives active while the Character is in your Adventure Area.',
    details:
      'Abilities formatted as "Adventure: Tap:" can be activated once during your Main Phase by exhausting (tapping) the Character. Abilities formatted as "Adventure: While..." are continuous effects that apply automatically whenever their condition is met.',
  },
  {
    id: 'kw-preplan',
    term: 'Pre-Plan',
    chapter: 'KEYWORDS',
    badge: 'Plan Keyword',
    summary: 'Triggers when a face-down Plan card under your Story is revealed by a Rival Breakthrough.',
    details:
      'When your Rival breaks through an uncontested lane and chooses to Intervene your Plan instead of progressing their Story, your next face-down Plan card is revealed. If it has a Pre-Plan ability, that effect resolves immediately, and the revealed card is added to your Hand.',
  },
  {
    id: 'kw-inspo-boost',
    term: 'Inspo Boost',
    chapter: 'KEYWORDS',
    badge: 'Scene Keyword',
    summary: 'Flip a face-up Scene card face-down during Contact to grant bonus Inspiration.',
    details:
      'During a contested Contact clash, players alternate passing or flipping an eligible face-up Scene face-down to grant their active Character +1 Inspiration (or the Scene’s listed bonus) until the end of the turn.',
    rulingNote:
      'A Scene flipped face-down still counts as a Scene in your Scene Area and can still be exhausted to pay Force of Harmony costs, though its passive text is inactive while face-down.',
  },
  {
    id: 'kw-switch-positions',
    term: 'Switch Positions',
    chapter: 'KEYWORDS',
    badge: 'Movement Keyword',
    summary: 'Swap two Characters between their Adventure Area lanes.',
    details:
      'Two Characters in the same Adventure Area trade lanes, carrying their attached Items, Treats, Presents, temporary Inspiration boosts, and tapped/untapped state with them.',
  },

  // CHAPTER IV: SET MECHANICS
  {
    id: 'mech-treat',
    term: 'Treat for you! (Nightmare Night)',
    chapter: 'MECHANICS',
    badge: 'BP03 Mechanic',
    summary: 'Place Treat counters onto Characters in the Adventure Area.',
    details:
      'Introduced in BP03, effects with "Treat for you!" place Treat counters on specified Characters. Many Nightmare Night cards gain bonus Inspiration or unlock extra abilities for Characters that currently hold—or have previously held—a Treat.',
    example:
      'Nightmare Night Carnival puts 1 Treat on each 「Nightmare Night」 Character in your Adventure Area, powering up cards like Legend of Nightmare Moon.',
  },
  {
    id: 'mech-deliver-present',
    term: 'Deliver Present (Hearth’s Warming)',
    chapter: 'MECHANICS',
    badge: 'BP04 Mechanic',
    summary: 'Attach the top card of your Main Deck face-down as a Present onto a Character.',
    details:
      'Introduced in BP04, Deliver Present takes the top card of your Main Deck without looking at it and tucks it face-down under a target Character as a Present. A Character can hold multiple Presents at once.',
  },
  {
    id: 'mech-unwrap-present',
    term: 'Unwrap Present (Hearth’s Warming)',
    chapter: 'MECHANICS',
    badge: 'BP04 Mechanic',
    summary: 'Send an attached Present to the Retirement Area to trigger bonus effects.',
    details:
      'When an effect unwraps a Present on a Character, move that Present card to its owner’s Retirement Area. Abilities that watch for a Present being unwrapped trigger immediately.',
    example:
      'BP04 Cutie Mark Crusaders (Apple Bloom, Scootaloo, Sweetie Belle) each gain +2 Inspiration whenever a Present in your Adventure Area is unwrapped.',
  },

  // CHAPTER V: CONTACT & BREAKTHROUGH
  {
    id: 'contact-order',
    term: 'Lane Resolution Order',
    chapter: 'COMBAT',
    badge: 'Contact Phase',
    summary: 'First Player attacks Left → Center → Right; Second Player attacks Right → Center → Left.',
    details:
      'When you enter the Contact Phase, every lane where you control a Character resolves one by one in directional order. Even Characters that were tapped to pay for an Adventure ability still participate in Contact!',
  },
  {
    id: 'contested-clash',
    term: 'Contested Lanes & Ties',
    chapter: 'COMBAT',
    badge: 'Contact Phase',
    summary: 'Compare total Inspiration after Inspo Boosts; lower or tied Characters Retire.',
    details:
      'If your Rival controls a Character directly across from your attacking Character, both players may alternate activating Inspo Boosts from face-up Scenes. Once both players pass consecutively, compare total Inspiration: the Character with lower Inspiration Retires. If both Characters tie, BOTH Characters Retire!',
  },
  {
    id: 'breakthrough-choice',
    term: 'Uncontested Breakthroughs',
    chapter: 'COMBAT',
    badge: 'Breakthrough',
    summary: 'Choose to Progress your Story (+1 Stage) OR Intervene your Rival’s face-down Plan.',
    details:
      'If the opposing lane is empty, your Character achieves a Breakthrough! You may either advance your Story by 1 Stage (triggering the newly revealed Story card’s promotion effect) OR force your Rival to reveal their next face-down Plan card (triggering any Pre-Plan effect and returning it to their Hand).',
    rulingNote:
      'Story Lock Rule: You cannot progress to a Story Stage if your Rival’s corresponding Plan card at that stage is still face-down—you must Intervene their Plan first!',
  },
];

const CHAPTERS: { id: ChapterId; label: string; icon: string; ribbonClass: string }[] = [
  { id: 'BASICS', label: 'I. Turn & Basics', icon: '✨', ribbonClass: 'ribbon-magic' },
  { id: 'ZONES', label: 'II. Zones & Cards', icon: '🏰', ribbonClass: 'ribbon-honesty' },
  { id: 'KEYWORDS', label: 'III. Keywords', icon: '📜', ribbonClass: 'ribbon-kindness' },
  { id: 'MECHANICS', label: 'IV. Set Mechanics', icon: '🎁', ribbonClass: 'ribbon-laughter' },
  { id: 'COMBAT', label: 'V. Contact & Story', icon: '⚔️', ribbonClass: 'ribbon-loyalty' },
  { id: 'INDEX', label: 'Arcane Index', icon: '🔍', ribbonClass: 'ribbon-generosity' },
];

const TURN_STEPS = [
  {
    step: '1. Ready Phase',
    detail: 'Untap (Ready) all exhausted Scenes in your Scene Area and all exhausted Characters in your Adventure Area.',
  },
  {
    step: '2. Draw & Scene Phase',
    detail: 'Draw 1 card from your Main Deck and flip the top card of your Scene Deck face-up into your Scene Area. (Both skipped on Turn 1 for the First Player.)',
  },
  {
    step: '3. Main Phase',
    detail: 'Play Characters, attach Items, cast Events, and activate Mane Leader or "Adventure: Tap:" abilities in any order.',
  },
  {
    step: '4. Contact Phase',
    detail: 'Resolve each occupied lane in order (Left→Right for P1, Right→Left for P2) to clash with opposing Characters or Breakthrough. (Skipped on Turn 1.)',
  },
  {
    step: '5. End Phase',
    detail: 'All temporary "until the end of turn" Inspiration buffs and debuffs wear off, and turn priority passes to your Rival.',
  },
];

export const RulesGlossaryTab: React.FC = () => {
  const [activeChapter, setActiveChapter] = useState<ChapterId>('BASICS');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string>(TOME_ENTRIES[0].id);
  const [activeTurnStep, setActiveTurnStep] = useState<number>(2);

  const visibleEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return TOME_ENTRIES.filter(
        (e) =>
          e.term.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.details.toLowerCase().includes(q) ||
          e.badge.toLowerCase().includes(q)
      );
    }
    if (activeChapter === 'INDEX') return TOME_ENTRIES;
    return TOME_ENTRIES.filter((e) => e.chapter === activeChapter);
  }, [activeChapter, searchQuery]);

  const activeEntry = useMemo(() => {
    return (
      visibleEntries.find((e) => e.id === selectedEntryId) ||
      visibleEntries[0] ||
      TOME_ENTRIES[0]
    );
  }, [visibleEntries, selectedEntryId]);

  const handleSelectChapter = (chapterId: ChapterId) => {
    setActiveChapter(chapterId);
    setSearchQuery('');
    const firstInChapter =
      chapterId === 'INDEX'
        ? TOME_ENTRIES[0]
        : TOME_ENTRIES.find((e) => e.chapter === chapterId);
    if (firstInChapter) {
      setSelectedEntryId(firstInChapter.id);
    }
  };

  const currentChapterIdx = CHAPTERS.findIndex((c) => c.id === activeChapter);

  return (
    <div className="storybook-stage">
      {/* Silk Ribbon Bookmarks */}
      <div className="storybook-ribbons">
        {CHAPTERS.map((chap) => (
          <button
            key={chap.id}
            className={`ribbon-bookmark ${chap.ribbonClass} ${
              activeChapter === chap.id && !searchQuery ? 'active' : ''
            }`}
            onClick={() => handleSelectChapter(chap.id)}
          >
            <span>{chap.icon}</span>
            <span>{chap.label}</span>
          </button>
        ))}
      </div>

      {/* Royal Leather Tome */}
      <div className="storybook-cover">
        <div className="storybook-spread">
          {/* LEFT PARCHMENT PAGE: Chapter Overview & Interactive Entry Selector */}
          <div className="storybook-page storybook-page-left page-animate-in" key={`L-${activeChapter}-${searchQuery}`}>
            <div>
              <div className="chapter-kicker">
                {searchQuery
                  ? 'Arcane Search Results'
                  : CHAPTERS[currentChapterIdx]?.label || 'Compendium'}
              </div>
              <h2 className="chapter-title">
                {searchQuery ? 'Searching the Tome' : 'The Elements of Harmony Rules'}
              </h2>

              {/* Search Input */}
              <div className="arcane-search-box">
                <input
                  type="text"
                  className="arcane-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search rules, keywords, or mechanics (e.g., Present, Treat, Duplicate)..."
                />
                {searchQuery && (
                  <button
                    className="arcane-search-clear"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Topic List */}
              {visibleEntries.length === 0 ? (
                <p className="storybook-prose">
                  No pages in the royal archives matched <strong>"{searchQuery}"</strong>. Try searching for{' '}
                  <em>Present</em>, <em>Treat</em>, <em>Pre-Plan</em>, or <em>Breakthrough</em>.
                </p>
              ) : (
                <div className="tome-entry-list">
                  {visibleEntries.map((entry) => (
                    <button
                      key={entry.id}
                      className={`tome-entry-btn ${activeEntry?.id === entry.id ? 'selected' : ''}`}
                      onClick={() => setSelectedEntryId(entry.id)}
                    >
                      <div className="tome-entry-header">
                        <span className="tome-entry-term">{entry.term}</span>
                        <span className="tome-entry-badge">{entry.badge}</span>
                      </div>
                      <p className="tome-entry-preview">{entry.summary}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="storybook-footer">
              <button
                className="page-turn-btn"
                disabled={currentChapterIdx <= 0}
                onClick={() => handleSelectChapter(CHAPTERS[currentChapterIdx - 1].id)}
              >
                ← Previous Chapter
              </button>
              <span>Page {currentChapterIdx * 2 + 1}</span>
            </div>
          </div>

          {/* RIGHT PARCHMENT PAGE: Detailed Illuminated Entry & Interactive Turn Guide */}
          <div className="storybook-page storybook-page-right page-animate-in" key={`R-${activeEntry?.id}`}>
            <div>
              <div className="chapter-kicker">Illuminated Ruling</div>
              <h2 className="chapter-title">{activeEntry.term}</h2>

              <div className="illuminated-scroll-box">
                <h3>
                  <span>✨</span> {activeEntry.summary}
                </h3>
                <p className="storybook-prose drop-cap" style={{ marginBottom: 0 }}>
                  {activeEntry.details}
                </p>

                {activeEntry.rulingNote && (
                  <div className="ruling-callout">
                    <strong>⚖️ Official Judge Ruling:</strong> {activeEntry.rulingNote}
                  </div>
                )}

                {activeEntry.example && (
                  <div className="example-callout">
                    <strong>📖 Gameplay Example:</strong> {activeEntry.example}
                  </div>
                )}
              </div>

              {/* Interactive Turn Sequence Reference */}
              <div>
                <div className="chapter-kicker" style={{ marginBottom: '6px' }}>
                  Interactive Turn Flow (Click a Phase)
                </div>
                <div className="turn-stepper-grid">
                  {TURN_STEPS.map((item, idx) => (
                    <div
                      key={item.step}
                      className={`turn-step-card ${activeTurnStep === idx ? 'active' : ''}`}
                      onClick={() => setActiveTurnStep(idx)}
                    >
                      <div className="turn-step-title">
                        <span>{item.step}</span>
                        <span>{activeTurnStep === idx ? '▾' : '▸'}</span>
                      </div>
                      {activeTurnStep === idx && (
                        <p className="turn-step-desc">{item.detail}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="storybook-footer">
              <span>Page {currentChapterIdx * 2 + 2}</span>
              <button
                className="page-turn-btn"
                disabled={currentChapterIdx >= CHAPTERS.length - 1}
                onClick={() => handleSelectChapter(CHAPTERS[currentChapterIdx + 1].id)}
              >
                Next Chapter →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RulesGlossaryTab;