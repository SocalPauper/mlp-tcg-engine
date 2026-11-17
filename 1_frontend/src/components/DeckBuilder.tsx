import React, { useState, useEffect, useRef } from 'react';
import './DeckBuilder.css';

interface Card {
  id: string;
  name: string;
  set_code: string;
  card_type: string;
  cost: number;
  power: number;
  defense: number;
  traits: string;
  effect_text: string;
  element: string | null;
  rarity: string;
  image_url: string;
}

interface StackedCardGroup {
  card: Card;
  copies: Card[];
  count: number;
  isStory?: boolean;
}

type BuildPhase = 'MANE' | 'STORY' | 'SCENE' | 'MAIN';

interface DeckBuilderProps {
  deckId: string | null;
  mode: 'CREATE' | 'EDIT' | 'VIEW' | 'COPY';
  onClose: () => void;
}

const API_BASE = 'https://mlp-tcg-engine.onrender.com';

function isValidManeCharacter(c: Card): boolean {
  if (c.card_type !== 'Mane Character') return false;
  const name = String(c.name || '');
  const id = String(c.id || '');
  const effect = String(c.effect_text || '');
  if (name.includes(' - ') || name.includes(' – ') || name.includes('Stage')) return false;
  if (id.includes('SPR') || id.includes('ER')) return false;
  if (/Experience Report|Inspo Boost|Choose 1 Character|Adventure Area|Retire/i.test(effect)) return false;
  if (Number(c.cost) > 0) return false;
  return true;
}

function isStoryCard(c: Card): boolean {
  return (
    c.card_type === 'Story' ||
    /-(?:C2[5-9]|C[3-4]\d)/i.test(c.id || '') ||
    (c.name || '').includes(' - ') ||
    (c.name || '').includes(' – ')
  );
}

export default function DeckBuilder({ deckId, mode, onClose }: DeckBuilderProps) {
  const [cards, setCards] = useState<Card[]>([]);
  
  // Progress & Inventory States
  const [unlockedCardIds, setUnlockedCardIds] = useState<string[]>([]);
  const [newlyUnlockedCards, setNewlyUnlockedCards] = useState<Card[]>([]);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showLockedCards, setShowLockedCards] = useState(false);

  // Deck Structure States
  const [maneCharacter, setManeCharacter] = useState<Card | null>(null);
  const [storyDeck, setStoryDeck] = useState<Card[]>([]);
  const [sceneDeck, setSceneDeck] = useState<Card[]>([]);
  const [mainDeck, setMainDeck] = useState<Card[]>([]);
  
  const [buildPhase, setBuildPhase] = useState<BuildPhase>('MANE');
  const deckElement = maneCharacter?.element || null;

  // Collapsible right-panel zones (auto-syncs with active phase, also manually toggleable)
  const [collapsedZones, setCollapsedZones] = useState<Record<BuildPhase, boolean>>({
    MANE: false,
    STORY: true,
    SCENE: true,
    MAIN: true,
  });
  
  // UI Meta States
  const [deckName, setDeckName] = useState('My Sparkle Deck');
  const [isPublic, setIsPublic] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRarity, setSelectedRarity] = useState<string | 'ALL'>('ALL');
  const [selectedMainType, setSelectedMainType] = useState<string | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);

  const [isStarter, setIsStarter] = useState(mode === 'VIEW');
  const [isCopiedStarter, setIsCopiedStarter] = useState(mode === 'COPY');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
  const [isSavingExit, setIsSavingExit] = useState(false);
  const [showDeckContents, setShowDeckContents] = useState(mode === 'VIEW');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');

  // Inspector & Story Carousel States
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [inspectorGroup, setInspectorGroup] = useState<Card[]>([]);
  const [inspectorIndex, setInspectorIndex] = useState<number>(0);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  // Switch active build phase and auto-collapse inactive deck zones on the right
  const activatePhase = (phase: BuildPhase) => {
    setShowDeckContents(false);
    setBuildPhase(phase);
    setCollapsedZones({
      MANE: phase !== 'MANE',
      STORY: phase !== 'STORY',
      SCENE: phase !== 'SCENE',
      MAIN: phase !== 'MAIN',
    });
  };

  const toggleZoneCollapse = (zone: BuildPhase) => {
    setCollapsedZones(prev => ({
      ...prev,
      [zone]: !prev[zone],
    }));
  };

  // 1. Fetch entire card catalog
  useEffect(() => {
    fetch(`${API_BASE}/api/cards`)
      .then(res => res.json())
      .then(data => {
        setCards(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load cards:', err);
        setLoading(false);
      });
  }, []);

  // 2. Fetch User Inventory & New Alerts from auth.user_cards
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || cards.length === 0) return;

    const loadCollection = async () => {
      try {
        let res = await fetch(`${API_BASE}/api/auth/me/collection`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          res = await fetch(`${API_BASE}/api/users/me/collection`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
        }
        if (!res.ok) return;

        const data = await res.json();
        if (Array.isArray(data)) {
          const ownedIds = data.map((item: any) => item.card_id);
          setUnlockedCardIds(ownedIds);

          const unalertedItems = data.filter((item: any) => item.user_alerted === false);
          if (unalertedItems.length > 0) {
            const newCards = unalertedItems
              .map((item: any) => cards.find(c => c.id === item.card_id))
              .filter(Boolean) as Card[];

            if (newCards.length > 0) {
              setNewlyUnlockedCards(newCards);
              setShowUnlockModal(true);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load collection:', err);
      }
    };

    loadCollection();
  }, [cards]);

  // 3. Fetch existing deck data if editing/viewing/copying
  useEffect(() => {
    if (!deckId || cards.length === 0) return;

    const token = localStorage.getItem('token');
    fetch(`${API_BASE}/api/decks/${deckId}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
      .then(res => {
        if (!res.ok) throw new Error('Deck not found');
        return res.json();
      })
      .then(deckData => {
        const starterFlag = Boolean(deckData.is_starter);
        const readOnlyView = (starterFlag && mode !== 'COPY') || mode === 'VIEW';
        setDeckName(mode === 'COPY' ? `${deckData.name} (Copy)` : deckData.name);
        setIsPublic(deckData.is_public ?? true);
        setIsStarter(readOnlyView);
        setIsCopiedStarter(mode === 'COPY');
        setHasUnsavedChanges(mode === 'COPY');

        const parseDeckField = (raw: any): any[] => {
          if (!raw) return [];
          if (typeof raw === 'string') {
            try {
              const parsed = JSON.parse(raw);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          }
          return Array.isArray(raw) ? raw : [];
        };

        const hydrateCards = (rawField: any): Card[] => {
          const list = parseDeckField(rawField);
          const hydrated: Card[] = [];
          for (const entry of list) {
            if (typeof entry === 'string') {
              const found = cards.find(c => c.id.toLowerCase() === entry.toLowerCase());
              if (found) hydrated.push(found);
            } else if (entry && typeof entry === 'object') {
              const id = entry.card_id || entry.id;
              const qty = Number(entry.quantity) || 1;
              const found = id ? cards.find(c => c.id.toLowerCase() === String(id).toLowerCase()) : null;
              if (found) {
                for (let i = 0; i < qty; i++) hydrated.push(found);
              }
            }
          }
          return hydrated;
        };

        const rawMane = typeof deckData.mane_character === 'object' && deckData.mane_character !== null
          ? (deckData.mane_character.card_id || deckData.mane_character.id)
          : deckData.mane_character;

        let loadedMane: Card | null = null;
        if (rawMane) {
          loadedMane = cards.find(c => c.id.toLowerCase() === String(rawMane).toLowerCase()) || null;
          if (loadedMane) setManeCharacter(loadedMane);
        }

        const loadedStory = hydrateCards(deckData.story_deck);
        const loadedScene = hydrateCards(deckData.scene_deck);
        const loadedMain = hydrateCards(deckData.main_deck);

        if (!rawMane && loadedStory.length === 0 && loadedScene.length === 0 && loadedMain.length === 0 && Array.isArray(deckData.cards)) {
          const allHydrated = hydrateCards(deckData.cards);
          const foundMane = allHydrated.find(isValidManeCharacter) || null;
          const stories = allHydrated.filter(c => c.card_type === 'Story');
          const scenes = allHydrated.filter(c => c.card_type === 'Scene');
          const mains = allHydrated.filter(c => !['Mane Character', 'Story', 'Scene'].includes(c.card_type));
          setManeCharacter(foundMane);
          setStoryDeck(stories);
          setSceneDeck(scenes);
          setMainDeck(mains);

          const count = (foundMane ? 1 : 0) + stories.length + scenes.length + mains.length;
          if (readOnlyView || count === 70) setShowDeckContents(true);
        } else {
          setStoryDeck(loadedStory);
          setSceneDeck(loadedScene);
          setMainDeck(loadedMain);

          const count = (loadedMane ? 1 : 0) + loadedStory.length + loadedScene.length + loadedMain.length;
          if (readOnlyView || count === 70) setShowDeckContents(true);
        }

        setBuildPhase('MAIN');
        setCollapsedZones({
          MANE: !readOnlyView,
          STORY: !readOnlyView,
          SCENE: !readOnlyView,
          MAIN: false,
        });
      })
      .catch(err => console.error('Error fetching deck:', err));
  }, [deckId, cards, mode]);

  const totalCards = (maneCharacter ? 1 : 0) + storyDeck.length + sceneDeck.length + mainDeck.length;

  // --- Logic Helpers ---

  const openInspector = (card: Card, group: Card[] = []) => {
    if (group.length > 0) {
      const idx = Math.max(0, group.findIndex(c => c.id === card.id));
      setInspectorGroup(group);
      setInspectorIndex(idx);
      setHoveredCard(group[idx]);
      return;
    }

    if (isStoryCard(card)) {
      const baseStoryName = card.name.split(/[-–]/)[0].trim().toLowerCase();
      const isAlt = card.id.includes('-S');
      const matchingArc = cards
        .filter(
          c =>
            isStoryCard(c) &&
            c.set_code === card.set_code &&
            c.id.includes('-S') === isAlt &&
            c.name.split(/[-–]/)[0].trim().toLowerCase() === baseStoryName
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      if (matchingArc.length > 1) {
        const idx = Math.max(0, matchingArc.findIndex(c => c.id === card.id));
        setInspectorGroup(matchingArc);
        setInspectorIndex(idx);
        setHoveredCard(matchingArc[idx]);
        return;
      }
    }

    setInspectorGroup([]);
    setInspectorIndex(0);
    setHoveredCard(card);
  };

  const closeInspector = () => {
    setHoveredCard(null);
    setInspectorGroup([]);
    setInspectorIndex(0);
  };

  const stepInspectorGroup = (direction: -1 | 1) => {
    if (inspectorGroup.length <= 1) return;
    const nextIdx = (inspectorIndex + direction + inspectorGroup.length) % inspectorGroup.length;
    setInspectorIndex(nextIdx);
    setHoveredCard(inspectorGroup[nextIdx]);
  };

  const handleAcknowledgeUnlocks = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setShowUnlockModal(false);
      setNewlyUnlockedCards([]);
      return;
    }

    try {
      let res = await fetch(`${API_BASE}/api/auth/me/collection/acknowledge`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        await fetch(`${API_BASE}/api/users/me/collection/acknowledge`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setShowUnlockModal(false);
      setNewlyUnlockedCards([]);
    }
  };

  const isCardLocked = (card: Card) => {
    if (/^SD/i.test(card.id) || /^SD/i.test(card.set_code || '')) return false;

    const rarity = String(card.rarity || 'C').toUpperCase();
    if (['C', 'U', 'R'].includes(rarity) && !card.id.includes('-S')) return false;

    const isEverydayScene =
      card.card_type === 'Scene' &&
      (!card.element ||
        card.element.toLowerCase() === 'everyday' ||
        /everyday/i.test(card.name || '') ||
        /-EV/i.test(card.id));
    if (isEverydayScene && !card.id.includes('-S')) return false;

    if (unlockedCardIds.includes(card.id)) return false;

    return true;
  };

  const handleContextMenu = (e: React.MouseEvent, card: Card, group: Card[] = []) => {
    e.preventDefault();
    openInspector(card, group);
  };

  const handleTouchStart = (card: Card, group: Card[] = []) => {
    longPressTimer.current = setTimeout(() => {
      openInspector(card, group);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const addCardToDeck = (card: Card) => {
    if (isStarter) return;
    if (isCardLocked(card)) return alert('You must unlock this rare card from a pack first!');

    const baseId = card.id.replace('-S', '');

    if (buildPhase === 'MANE') {
      setManeCharacter(card);
      setHasUnsavedChanges(true);
      if (storyDeck.length === 0) activatePhase('STORY');
    } 
    else if (buildPhase === 'SCENE') {
      if (sceneDeck.length >= 15) return alert('Scene Deck is full (15/15).');
      
      const copies = sceneDeck.filter(c => c.id.replace('-S', '') === baseId).length;
      const isEveryday = card.element === 'Everyday' || !card.element;

      if (!isEveryday && copies >= 3) {
        return alert('You can only have up to 3 copies of an element-specific Scene.');
      }
      
      const nextScene = [...sceneDeck, card];
      setSceneDeck(nextScene);
      setHasUnsavedChanges(true);
      if ((maneCharacter ? 1 : 0) + storyDeck.length + nextScene.length + mainDeck.length === 70) {
        setShowDeckContents(true);
      }
    } 
    else if (buildPhase === 'MAIN') {
      if (mainDeck.length >= 50) return alert('Main Deck is full (50/50).');
      const copies = mainDeck.filter(c => c.id.replace('-S', '') === baseId).length;
      if (copies >= 3) return alert('You can only have 3 copies of any card.');
      
      const nextMain = [...mainDeck, card];
      setMainDeck(nextMain);
      setHasUnsavedChanges(true);
      if ((maneCharacter ? 1 : 0) + storyDeck.length + sceneDeck.length + nextMain.length === 70) {
        setShowDeckContents(true);
      }
    }
  };

  const addStoryGroup = (group: Card[]) => {
    if (isStarter) return; 
    if (group.some(c => isCardLocked(c))) return alert('You must unlock this alternate art first!');
    if (storyDeck.length + group.length > 4) return alert('Story Deck can only hold 4 cards.');
    
    const nextStory = [...storyDeck, ...group];
    setStoryDeck(nextStory);
    setHasUnsavedChanges(true);
    if ((maneCharacter ? 1 : 0) + nextStory.length + sceneDeck.length + mainDeck.length === 70) {
      setShowDeckContents(true);
    }
  };

  const removeCard = (zone: string, index: number) => {
    if (isStarter) return; 

    if (zone === 'mane') {
      const confirmReset = window.confirm('Removing your Mane Character will clear the entire deck to prevent element conflicts. Continue?');
      if (confirmReset) {
        setManeCharacter(null);
        setStoryDeck([]);
        setSceneDeck([]);
        setMainDeck([]);
        activatePhase('MANE');
        setHasUnsavedChanges(true);
      }
    } else if (zone === 'story') {
      setStoryDeck([]);
      setHasUnsavedChanges(true);
    } else if (zone === 'scene') {
      setSceneDeck(sceneDeck.filter((_, i) => i !== index));
      setHasUnsavedChanges(true);
    } else if (zone === 'main') {
      setMainDeck(mainDeck.filter((_, i) => i !== index));
      setHasUnsavedChanges(true);
    }
  };

  const handleClearDeck = () => {
    if (isStarter) return;
    const confirmed = window.confirm('Are you sure you want to clear all cards from this deck?');
    if (!confirmed) return;

    setManeCharacter(null);
    setStoryDeck([]);
    setSceneDeck([]);
    setMainDeck([]);
    activatePhase('MANE');
    setHasUnsavedChanges(true);
  };

  const handleCopyDeck = () => {
    setIsStarter(false);
    setIsCopiedStarter(true);
    setHasUnsavedChanges(true);
    setShowDeckContents(false);
    setDeckName(`${deckName} (Copy)`);
    alert('Deck copied! You can now make changes and save it to your account.');
  };

  // --- Save & Return to Stable Handlers ---

  const saveDeckToServer = async (): Promise<boolean> => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('You must be signed in to save your deck to your account.');
      return false;
    }

    const deckPayload = {
      name: deckName,
      is_public: isPublic,
      mane_character: maneCharacter?.id,
      story_deck: storyDeck.map(c => c.id),
      scene_deck: sceneDeck.map(c => c.id),
      main_deck: mainDeck.map(c => c.id)
    };

    const isEditingOwnDeck = mode === 'EDIT' && deckId && !isCopiedStarter;
    const endpoint = isEditingOwnDeck ? `/api/decks/${deckId}` : '/api/decks';
    const method = isEditingOwnDeck ? 'PUT' : 'POST';

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(deckPayload)
      });
      if (!res.ok) throw new Error('Save failed');
      await res.json();
      setHasUnsavedChanges(false);
      return true;
    } catch {
      alert('Failed to save deck.');
      return false;
    }
  };

  const handleSaveDeck = async () => {
    const saved = await saveDeckToServer();
    if (saved) {
      alert('Deck successfully saved!');
      onClose();
    }
  };

  const handleReturnToStable = () => {
    if (!isStarter && totalCards > 0 && hasUnsavedChanges) {
      setShowExitConfirmModal(true);
      return;
    }
    onClose();
  };

  const handleSaveAndExit = async () => {
    setIsSavingExit(true);
    const saved = await saveDeckToServer();
    setIsSavingExit(false);
    if (saved) {
      setShowExitConfirmModal(false);
      onClose();
    }
  };

  const handleDiscardAndExit = () => {
    setShowExitConfirmModal(false);
    onClose();
  };

  const handleExportDeck = () => {
    const exportList = [
      `// Deck: ${deckName}`,
      `Mane: ${maneCharacter ? maneCharacter.id : 'None'}`,
      `--- Story (${storyDeck.length}) ---`,
      ...storyDeck.map(c => `1x ${c.id} ${c.name}`),
      `--- Scene (${sceneDeck.length}) ---`,
      ...sceneDeck.map(c => `1x ${c.id} ${c.name}`),
      `--- Main (${mainDeck.length}) ---`,
      ...mainDeck.map(c => `1x ${c.id} ${c.name}`)
    ].join('\n');
    navigator.clipboard.writeText(exportList);
    alert('Decklist copied to clipboard in standard Kayou format!');
  };

  const handleImportDeck = () => {
    const lines = importText.split('\n');
    let foundMane: Card | null = null;
    const foundStories: Card[] = [];
    const foundScenes: Card[] = [];
    const foundMains: Card[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('---')) continue;
      
      const match = trimmed.match(/^(?:(\d+)x?\s+)?([A-Z0-9-]+)\s+(.*)$/i) || trimmed.match(/^([A-Z0-9-]+)\s+(.*)$/i);
      if (match) {
        const cardId = match[2] || match[1];
        const qty = match[1] && !isNaN(Number(match[1])) ? parseInt(match[1], 10) : 1;
        const cardObj = cards.find(c => c.id.toLowerCase() === cardId.toLowerCase());
        if (cardObj) {
          if (isValidManeCharacter(cardObj)) foundMane = cardObj;
          else if (isStoryCard(cardObj)) foundStories.push(cardObj);
          else if (cardObj.card_type === 'Scene') {
            for (let i = 0; i < qty; i++) foundScenes.push(cardObj);
          } else {
            for (let i = 0; i < qty; i++) foundMains.push(cardObj);
          }
        }
      }
    }

    if (foundMane) setManeCharacter(foundMane);
    if (foundStories.length > 0) setStoryDeck(foundStories.slice(0, 4));
    if (foundScenes.length > 0) setSceneDeck(foundScenes.slice(0, 15));
    if (foundMains.length > 0) setMainDeck(foundMains.slice(0, 50));

    setImportModalOpen(false);
    setImportText('');
    activatePhase('MAIN');
    setHasUnsavedChanges(true);
    alert('Deck successfully imported!');
  };

  // --- Grouping Helper for Deck Contents Showcase ---

  const groupCardsById = (cardList: Card[], isStoryGroup: boolean = false): StackedCardGroup[] => {
    const groupedMap = new Map<string, StackedCardGroup>();
    for (const c of cardList) {
      const existing = groupedMap.get(c.id);
      if (existing) {
        existing.copies.push(c);
        existing.count += 1;
      } else {
        groupedMap.set(c.id, {
          card: c,
          copies: [c],
          count: 1,
          isStory: isStoryGroup,
        });
      }
    }
    return Array.from(groupedMap.values());
  };

  // --- Rendering Helpers ---

  const baseFilteredCards = cards.filter(card => {
    const matchesSearch = card.name.toLowerCase().includes(searchQuery.toLowerCase()) || card.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRarity = selectedRarity === 'ALL' || card.rarity === selectedRarity;
    const matchesUnlockVisibility = showLockedCards || !isCardLocked(card);
    return matchesSearch && matchesRarity && matchesUnlockVisibility;
  });

  let displayCards: Card[] = [];
  if (buildPhase === 'MANE') {
    const validManes = baseFilteredCards.filter(isValidManeCharacter);
    const seenImages = new Set<string>();
    const seenNameSet = new Set<string>();
    displayCards = validManes.filter(c => {
      const imgKey = (c.image_url || '').trim().toLowerCase();
      const nameSetKey = `${c.name.trim().toLowerCase()}|${(c.set_code || '').trim().toLowerCase()}|${c.id.includes('-S') ? 'alt' : 'std'}`;
      if ((imgKey && seenImages.has(imgKey)) || seenNameSet.has(nameSetKey)) {
        return false;
      }
      if (imgKey) seenImages.add(imgKey);
      seenNameSet.add(nameSetKey);
      return true;
    });
  } else if (buildPhase === 'STORY') {
    displayCards = baseFilteredCards.filter(isStoryCard);
  } else if (buildPhase === 'SCENE') {
    displayCards = baseFilteredCards.filter(c => 
      c.card_type === 'Scene' && 
      (c.element === 'Everyday' || !c.element || c.element === deckElement || !deckElement)
    );
  } else if (buildPhase === 'MAIN') {
    displayCards = baseFilteredCards.filter(c => {
      const isValidType = ['Character', 'Friend Character', 'Event', 'Item'].includes(c.card_type) && 
                          c.card_type !== 'Story' && 
                          !c.name.includes(' - ') && 
                          !c.name.includes(' – ') &&
                          !isValidManeCharacter(c);
      
      const matchesMainType = selectedMainType === 'ALL' || c.card_type === selectedMainType;
      const matchesElement = c.element === deckElement || !c.element || c.element === 'Everyday' || !deckElement;
      return isValidType && matchesMainType && matchesElement;
    });
  }

  const storyGroups: Record<string, Card[]> = {};
  const setBuckets: Record<string, Card[]> = {};
  displayCards.forEach(card => {
    const setCode = card.set_code || 'BP01';
    if (!setBuckets[setCode]) setBuckets[setCode] = [];
    setBuckets[setCode].push(card);
  });

  Object.entries(setBuckets).forEach(([setCode, setCardList]) => {
    const normalCards = setCardList.filter(c => !c.id.includes('-S')).sort((a, b) => a.id.localeCompare(b.id));
    const altCards = setCardList.filter(c => c.id.includes('-S')).sort((a, b) => a.id.localeCompare(b.id));
    
    const chunkArray = (arr: Card[], isAlt: boolean) => {
      for (let i = 0; i < arr.length; i += 4) {
        const chunk = arr.slice(i, i + 4);
        if (chunk.length === 0) continue;
        const baseName = chunk[0].name.split(/[-–]/)[0].trim();
        const groupKey = `${setCode}-Chunk-${Math.floor(i / 4)}-${baseName}${isAlt ? '-Alt' : ''}`;
        storyGroups[groupKey] = chunk;
      }
    };

    chunkArray(normalCards, false);
    chunkArray(altCards, true);
  });

  const isHoveredStory = hoveredCard ? isStoryCard(hoveredCard) : false;

  const groupedScenes = groupCardsById(sceneDeck, false);
  const groupedMain = groupCardsById(mainDeck, false);

  return (
    <div className="deck-builder-container">

      {/* --- UNSAVED DECK EXIT CONFIRMATION MODAL --- */}
      {showExitConfirmModal && (
        <div
          className="inspector-overlay"
          style={{ pointerEvents: 'auto', zIndex: 10001 }}
          onClick={() => !isSavingExit && setShowExitConfirmModal(false)}
        >
          <div
            className="inspector-modal"
            style={{
              flexDirection: 'column',
              padding: '28px 32px',
              height: 'auto',
              width: '460px',
              textAlign: 'center',
              gap: '16px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ color: '#fff', margin: 0, fontSize: '22px', fontWeight: 900 }}>
              Unsaved Deck Changes ✨
            </h2>
            <p style={{ color: '#d0d7e2', margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
              Your deck <strong>“{deckName}”</strong> ({totalCards}/70 cards) has unsaved changes.
              Would you like to save it before returning to the Stable?
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
              <button
                className="action-btn save-btn"
                style={{ padding: '12px 16px', fontSize: '13px' }}
                onClick={handleSaveAndExit}
                disabled={isSavingExit}
              >
                {isSavingExit ? 'Saving...' : 'Save & Exit 💾'}
              </button>
              <button
                className="action-btn clear-btn"
                style={{ padding: '12px 16px', fontSize: '13px' }}
                onClick={handleDiscardAndExit}
                disabled={isSavingExit}
              >
                Discard & Exit 🗑️
              </button>
              <button
                className="phase-btn"
                style={{ padding: '10px 16px', fontSize: '13px' }}
                onClick={() => setShowExitConfirmModal(false)}
                disabled={isSavingExit}
              >
                Keep Editing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- UNLOCK CELEBRATION MODAL --- */}
      {showUnlockModal && newlyUnlockedCards.length > 0 && (
        <div className="inspector-overlay" style={{ pointerEvents: 'auto', zIndex: 10000 }}>
          <div className="unlock-modal">
            <h2 className="unlock-title">✨ New Rares Unlocked! ✨</h2>
            <div className="unlocked-cards-grid">
              {newlyUnlockedCards.map(c => (
                <div key={c.id} className="unlocked-card-item">
                  <img src={c.image_url} alt={c.name} />
                </div>
              ))}
            </div>
            <button className="phase-btn active glow-btn" onClick={handleAcknowledgeUnlocks}>
              Awesome!
            </button>
          </div>
        </div>
      )}
      
      {/* Import Modal */}
      {importModalOpen && (
        <div className="inspector-overlay" style={{ pointerEvents: 'auto' }}>
          <div className="inspector-modal" style={{ flexDirection: 'column', padding: '30px', height: 'auto', width: '500px' }}>
            <h2 style={{ color: '#fff', marginBottom: '15px' }}>Import Decklist</h2>
            <textarea 
              rows={10} 
              value={importText} 
              onChange={e => setImportText(e.target.value)}
              placeholder="Paste deck list here..."
              style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#222831', color: '#fff', border: '1px solid #444', marginBottom: '15px' }}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="phase-btn" onClick={() => setImportModalOpen(false)}>Cancel</button>
              <button className="phase-btn active" onClick={handleImportDeck}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Card Inspector Tooltip */}
      {hoveredCard && (
        <div className="inspector-overlay" style={{ pointerEvents: 'auto' }} onClick={closeInspector}>
          <div
            className={`inspector-modal ${isHoveredStory ? 'story-landscape-modal' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            <button className="inspector-close-btn" onClick={closeInspector}>✕</button>
            <div className={`inspector-image-container ${isHoveredStory ? 'story-landscape-box' : ''}`}>
              {inspectorGroup.length > 1 && (
                <button
                  type="button"
                  className="story-nav-arrow prev"
                  onClick={() => stepInspectorGroup(-1)}
                  title="Previous Story Stage"
                >
                  ‹
                </button>
              )}

              <img src={hoveredCard.image_url} alt={hoveredCard.name} />

              {inspectorGroup.length > 1 && (
                <>
                  <button
                    type="button"
                    className="story-nav-arrow next"
                    onClick={() => stepInspectorGroup(1)}
                    title="Next Story Stage"
                  >
                    ›
                  </button>
                  <div className="story-stage-indicator">
                    Stage {inspectorIndex + 1} of {inspectorGroup.length}
                  </div>
                </>
              )}
            </div>
            <div className="inspector-data-panel">
              <div className="inspector-header">
                <h2>{hoveredCard.name}</h2>
                {['Character', 'Friend Character', 'Event', 'Item'].includes(hoveredCard.card_type) && (
                   <div className="cost-badge">{hoveredCard.cost}</div>
                )}
              </div>
              
              <div className="inspector-meta-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '15px 0' }}>
                <div className="meta-block">
                  <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>TYPE</span>
                  <span className="meta-value" style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{hoveredCard.card_type}</span>
                </div>
                <div className="meta-block">
                  <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>RARITY</span>
                  <span className="meta-value" style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{hoveredCard.rarity}</span>
                </div>
              </div>

              {hoveredCard.element && (
                <div className="inspector-meta-block" style={{ marginBottom: '15px' }}>
                  <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>ELEMENT</span>
                  <span className="meta-value" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--mlp-pink)' }}>{hoveredCard.element}</span>
                </div>
              )}

              <div className="inspector-rules-text" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', marginBottom: '15px' }}>
                <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '6px' }}>RULES TEXT</span>
                <p style={{ fontSize: '13px', color: '#ddd', lineHeight: '1.4', margin: 0 }}>
                  {hoveredCard.effect_text || (hoveredCard.id.includes('ER') ? 'Inspo Boost: Your matching characters get +1 Inspiration until the end of this contact.' : 'No abilities.')}
                </p>
              </div>

              {['Character', 'Friend Character'].includes(hoveredCard.card_type) && (
                <div className="inspector-power-row" style={{ marginBottom: '15px' }}>
                  <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>POWER</span>
                  <span className="power-value" style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{hoveredCard.power}</span>
                </div>
              )}

              <div className="inspector-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', borderTop: '1px solid #333', paddingTop: '12px' }}>
                <span className="set-id" style={{ fontSize: '12px', color: '#aaa', fontFamily: 'monospace' }}>{hoveredCard.id}</span>
                {hoveredCard.element && <span className={`element-tag ${hoveredCard.element.toLowerCase()}`} style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', background: '#333', color: '#fff' }}>{hoveredCard.element}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Library / Deck Contents Showcase */}
      <div className="card-library-section">
        {/* Sticky Top Header (Phase Tabs + Search/Filters + Show Deck Contents Toggle) */}
        <div className="library-sticky-header">
          <div className="phase-tracker">
            <button
              className={`phase-btn ${!showDeckContents && buildPhase === 'MANE' ? 'active' : ''}`}
              onClick={() => activatePhase('MANE')}
            >
              1. Mane
            </button>
            <button
              className={`phase-btn ${!showDeckContents && buildPhase === 'STORY' ? 'active' : ''}`}
              onClick={() => activatePhase('STORY')}
            >
              2. Story
            </button>
            <button
              className={`phase-btn ${!showDeckContents && buildPhase === 'SCENE' ? 'active' : ''}`}
              onClick={() => activatePhase('SCENE')}
            >
              3. Scenes
            </button>
            <button
              className={`phase-btn ${!showDeckContents && buildPhase === 'MAIN' ? 'active' : ''}`}
              onClick={() => activatePhase('MAIN')}
            >
              4. Main Deck
            </button>
            <button
              className={`phase-btn showcase-tab-btn ${showDeckContents ? 'active' : ''}`}
              onClick={() => setShowDeckContents(prev => !prev)}
            >
              {showDeckContents ? '📖 Browse Library' : `✦ Show Deck Contents (${totalCards}/70)`}
            </button>
          </div>

          {!showDeckContents && (
            <div className="filters-bar">
              <input 
                type="text" 
                placeholder="Search ponies, items, IDs..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="search-input input-bubble"
              />
              {buildPhase === 'MAIN' && (
                <select value={selectedMainType} onChange={e => setSelectedMainType(e.target.value)} className="rarity-select input-bubble">
                  <option value="ALL">All Types</option>
                  <option value="Character">Character</option>
                  <option value="Friend Character">Friend Character</option>
                  <option value="Event">Event</option>
                  <option value="Item">Item</option>
                </select>
              )}
              <select value={selectedRarity} onChange={e => setSelectedRarity(e.target.value)} className="rarity-select input-bubble">
                <option value="ALL">All Rarities</option>
                <option value="C">Common (C)</option>
                <option value="U">Uncommon (U)</option>
                <option value="R">Rare (R)</option>
                <option value="SR">Super Rare (SR)</option>
                <option value="SSR">Super Secret Rare (SSR)</option>
                <option value="UR">Ultra Rare (UR)</option>
                <option value="GR">Gold Rare (GR)</option>
                <option value="CR">Crystal Rare (CR)</option>
                <option value="SPR">Special Parallel (SPR)</option>
              </select>

              <label className="locked-toggle-pill">
                <input
                  type="checkbox"
                  checked={showLockedCards}
                  onChange={e => setShowLockedCards(e.target.checked)}
                />
                <span>Show Locked 🔒</span>
              </label>
            </div>
          )}
        </div>

        {showDeckContents ? (
          <div className="completed-deck-showcase">
            <div className="showcase-header-banner">
              <div>
                <h2 className="showcase-deck-title">{deckName}</h2>
                <span className="showcase-deck-subtitle">
                  {deckElement || 'Unaligned'} Element • {totalCards} / 70 Cards
                </span>
              </div>
              <button
                className="phase-btn"
                style={{ flex: '0 0 auto', padding: '8px 16px' }}
                onClick={() => setShowDeckContents(false)}
              >
                Back to Card Pool
              </button>
            </div>

            {totalCards === 0 ? (
              <div className="empty-zone" style={{ padding: '40px', fontSize: '15px' }}>
                No cards in this deck yet. Switch back to the card pool to start building!
              </div>
            ) : (
              <>
                {/* Section 1: Mane Character & Story Arc */}
                {(maneCharacter || storyDeck.length > 0) && (
                  <div className="showcase-section">
                    <h3 className="showcase-section-title">Mane Character & Story Deck</h3>
                    <div className="showcase-top-row">
                      {maneCharacter && (
                        <div
                          className="stacked-deck-slot"
                          onClick={() => openInspector(maneCharacter)}
                          onContextMenu={(e) => handleContextMenu(e, maneCharacter)}
                        >
                          <div className="card-copy-stack count-1">
                            <img src={maneCharacter.image_url} alt={maneCharacter.name} className="stacked-copy-img layer-0" />
                          </div>
                          <div className="diamond-count-wrapper">
                            <div className="diamond-badge"><span>1</span></div>
                            <span className="diamond-copies-label">Mane</span>
                          </div>
                        </div>
                      )}

                      {storyDeck.length > 0 && (
                        <div
                          className="stacked-deck-slot story-showcase-slot"
                          onClick={() => openInspector(storyDeck[0], storyDeck)}
                          onContextMenu={(e) => handleContextMenu(e, storyDeck[0], storyDeck)}
                        >
                          <div className={`story-copy-stack count-${Math.min(storyDeck.length, 4)}`}>
                            {storyDeck.slice(0, 4).map((sc, idx) => (
                              <img
                                key={`${sc.id}-${idx}`}
                                src={sc.image_url}
                                alt={sc.name}
                                className={`stacked-story-img layer-${idx}`}
                              />
                            ))}
                          </div>
                          <div className="diamond-count-wrapper">
                            <div className="diamond-badge"><span>{storyDeck.length}</span></div>
                            <span className="diamond-copies-label">Stages</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Section 2: Scene Deck */}
                {groupedScenes.length > 0 && (
                  <div className="showcase-section">
                    <h3 className="showcase-section-title">Scene Deck ({sceneDeck.length}/15)</h3>
                    <div className="showcase-cards-grid">
                      {groupedScenes.map((group) => (
                        <div
                          key={group.card.id}
                          className="stacked-deck-slot"
                          onClick={() => openInspector(group.card)}
                          onContextMenu={(e) => handleContextMenu(e, group.card)}
                        >
                          <div className={`card-copy-stack count-${Math.min(group.count, 5)}`}>
                            {group.copies.slice(0, 5).map((copyCard, idx) => (
                              <img
                                key={`${copyCard.id}-${idx}`}
                                src={copyCard.image_url}
                                alt={copyCard.name}
                                className={`stacked-copy-img layer-${idx}`}
                              />
                            ))}
                          </div>
                          <div className="diamond-count-wrapper">
                            <div className="diamond-badge"><span>{group.count}</span></div>
                            <span className="diamond-copies-label">
                              {group.count === 1 ? 'Copy' : 'Copies'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 3: Main Deck */}
                {groupedMain.length > 0 && (
                  <div className="showcase-section">
                    <h3 className="showcase-section-title">Main Deck ({mainDeck.length}/50)</h3>
                    <div className="showcase-cards-grid">
                      {groupedMain.map((group) => (
                        <div
                          key={group.card.id}
                          className="stacked-deck-slot"
                          onClick={() => openInspector(group.card)}
                          onContextMenu={(e) => handleContextMenu(e, group.card)}
                        >
                          <div className={`card-copy-stack count-${Math.min(group.count, 5)}`}>
                            {group.copies.slice(0, 5).map((copyCard, idx) => (
                              <img
                                key={`${copyCard.id}-${idx}`}
                                src={copyCard.image_url}
                                alt={copyCard.name}
                                className={`stacked-copy-img layer-${idx}`}
                              />
                            ))}
                          </div>
                          <div className="diamond-count-wrapper">
                            <div className="diamond-badge"><span>{group.count}</span></div>
                            <span className="diamond-copies-label">
                              {group.count === 1 ? 'Copy' : 'Copies'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : loading ? (
          <div className="loading-sparkles">Gathering cards... ✨</div>
        ) : (
          <div className="card-grid" style={{ opacity: isStarter ? 0.5 : 1, pointerEvents: isStarter ? 'none' : 'auto' }}>
            {buildPhase === 'STORY' ? (
              Object.entries(storyGroups).map(([groupKey, group]) => {
                const displayName = group[0]?.name ? group[0].name.split(/[-–]/)[0].trim() : groupKey;
                const isLocked = group.some(c => isCardLocked(c));
                return (
                  <div 
                    key={groupKey} 
                    className={`story-stack ${isLocked ? 'locked' : ''}`} 
                    onClick={() => {
                      if (isLocked) alert('You must unlock this alternate art first!');
                      else addStoryGroup(group);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, group[0], group)}
                    onTouchStart={() => handleTouchStart(group[0], group)}
                    onTouchEnd={handleTouchEnd}
                  >
                    {group.map((card) => (
                      <img 
                        key={card.id}
                        className="story-card-layer"
                        src={card.image_url} 
                        alt={card.name} 
                      />
                    ))}
                    {isLocked && <div className="lock-icon">🔒</div>}
                    <div className="story-stack-label">{displayName} {isLocked ? '(Locked)' : `(${group.length}/4)`}</div>
                  </div>
                );
              })
            ) : (
              displayCards.map(card => {
                const isLocked = isCardLocked(card);
                return (
                  <div 
                    key={card.id} 
                    className={`card-item ${isLocked ? 'locked' : ''}`} 
                    onClick={() => {
                      if (isLocked) alert('You must unlock this rare card from a pack first!');
                      else addCardToDeck(card);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, card)}
                    onTouchStart={() => handleTouchStart(card)}
                    onTouchEnd={handleTouchEnd}
                  >
                    <img src={card.image_url} alt={card.name} loading="lazy" />
                    {isLocked && <div className="lock-icon">🔒</div>}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Right Deck Zones Panel (Auto-Collapses Inactive Zones) */}
      <div className="deck-panel-section">
        <button 
          onClick={handleReturnToStable} 
          style={{ 
            background: 'rgba(156, 39, 176, 0.1)', 
            color: 'var(--mlp-purple)', 
            border: '2px solid var(--mlp-purple)', 
            padding: '8px 16px', 
            borderRadius: '12px', 
            fontWeight: 'bold', 
            cursor: 'pointer', 
            marginBottom: '16px',
            alignSelf: 'flex-start'
          }}
        >
          🔙 Return to Stable
        </button>

        {isStarter && (
          <div style={{ background: 'var(--mlp-purple)', color: 'white', padding: '12px', borderRadius: '12px', textAlign: 'center', fontWeight: 'bold', marginBottom: '16px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
            This starter deck is Read-Only. <br/>
            <span style={{ fontSize: '13px', fontWeight: 'normal' }}>Copy it to make changes.</span>
          </div>
        )}

        <div className={`decorated-element-banner ${deckElement ? deckElement.toLowerCase() : 'unaligned'}`}>
          <div className="banner-glow-effect"></div>
          <span className="banner-star">✨</span>
          <span className="banner-text">{deckElement ? `Current Element: ${deckElement}` : 'Awaiting Mane Character...'}</span>
          <span className="banner-star">✨</span>
        </div>

        <div className="deck-name-container">
          <label className="deck-name-label">Deck Name ✏️</label>
          <input 
            type="text" 
            value={deckName} 
            onChange={e => { setDeckName(e.target.value); setHasUnsavedChanges(true); }} 
            placeholder="Name your deck!"
            className="deck-name-input input-bubble"
            disabled={isStarter}
          />
        </div>

        <div className="deck-visibility-bar">
          <label className="visibility-switch">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={e => { setIsPublic(e.target.checked); setHasUnsavedChanges(true); }}
              disabled={isStarter}
            />
            <span className="slider round"></span>
          </label>
          <span className="visibility-label">{isPublic ? 'Public Deck 🌍' : 'Private Deck 🔒'}</span>
        </div>

        <div className="deck-header-stats">
          <span>Cards: <strong>{totalCards}</strong> / 70</span>
        </div>

        <div className="deck-zones-container">
          {/* Collapsible Zone 1: Mane Character */}
          <div className={`deck-zone ${collapsedZones.MANE ? 'collapsed' : ''}`}>
            <h3 className="collapsible-zone-header" onClick={() => toggleZoneCollapse('MANE')}>
              <span>Mane Character ({maneCharacter ? 1 : 0}/1)</span>
              <span className="collapse-chevron">{collapsedZones.MANE ? '▶' : '▼'}</span>
            </h3>
            {!collapsedZones.MANE && (
              maneCharacter ? (
                <div className="deck-row mane-row" onClick={() => removeCard('mane', 0)}>
                  <span>{maneCharacter.name}</span>
                  {!isStarter && <span className="remove-tag">✕</span>}
                </div>
              ) : <div className="empty-zone">Select a Mane Character</div>
            )}
          </div>

          {/* Collapsible Zone 2: Story Deck */}
          <div className={`deck-zone ${collapsedZones.STORY ? 'collapsed' : ''}`}>
            <h3 className="collapsible-zone-header" onClick={() => toggleZoneCollapse('STORY')}>
              <span>Story Deck ({storyDeck.length}/4)</span>
              <span className="collapse-chevron">{collapsedZones.STORY ? '▶' : '▼'}</span>
            </h3>
            {!collapsedZones.STORY && (
              storyDeck.length > 0 ? (
                storyDeck.map((c, i) => (
                  <div key={i} className="deck-row" onClick={() => removeCard('story', i)}>
                    <span>{c.name}</span>{!isStarter && <span className="remove-tag">✕</span>}
                  </div>
                ))
              ) : <div className="empty-zone">Select Story Cards</div>
            )}
          </div>

          {/* Collapsible Zone 3: Scene Deck */}
          <div className={`deck-zone ${collapsedZones.SCENE ? 'collapsed' : ''}`}>
            <h3 className="collapsible-zone-header" onClick={() => toggleZoneCollapse('SCENE')}>
              <span>Scene Deck ({sceneDeck.length}/15)</span>
              <span className="collapse-chevron">{collapsedZones.SCENE ? '▶' : '▼'}</span>
            </h3>
            {!collapsedZones.SCENE && (
              sceneDeck.length > 0 ? (
                sceneDeck.map((c, i) => (
                  <div key={i} className="deck-row" onClick={() => removeCard('scene', i)}>
                    <span>{c.name}</span>{!isStarter && <span className="remove-tag">✕</span>}
                  </div>
                ))
              ) : <div className="empty-zone">Select Scene Cards</div>
            )}
          </div>

          {/* Collapsible Zone 4: Main Deck */}
          <div className={`deck-zone main-deck-zone ${collapsedZones.MAIN ? 'collapsed' : ''}`}>
            <h3 className="collapsible-zone-header" onClick={() => toggleZoneCollapse('MAIN')}>
              <span>Main Deck ({mainDeck.length}/50)</span>
              <span className="collapse-chevron">{collapsedZones.MAIN ? '▶' : '▼'}</span>
            </h3>
            {!collapsedZones.MAIN && (
              mainDeck.length > 0 ? (
                mainDeck.map((c, i) => (
                  <div key={i} className="deck-row" onClick={() => removeCard('main', i)}>
                    <span>{c.name}</span>{!isStarter && <span className="remove-tag">✕</span>}
                  </div>
                ))
              ) : <div className="empty-zone">Select Main Deck Cards</div>
            )}
          </div>
        </div>

        <div className="deck-actions-bar">
          {isStarter ? (
            <button className="action-btn save-btn" onClick={handleCopyDeck} style={{ background: 'var(--mlp-pink)' }}>Copy to Edit 📝</button>
          ) : (
            <>
              <button className="action-btn save-btn" onClick={handleSaveDeck}>Save 💾</button>
              <button className="action-btn clear-btn" onClick={handleClearDeck}>Clear 🗑️</button>
              <button className="action-btn import-btn" onClick={() => setImportModalOpen(true)}>Import 📥</button>
            </>
          )}
          <button className="action-btn export-btn" onClick={handleExportDeck}>Export 📤</button>
        </div>

      </div>
    </div>
  );
}