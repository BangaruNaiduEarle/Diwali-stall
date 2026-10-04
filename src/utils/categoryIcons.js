import {
  Bomb,
  CircleDot,
  Gift,
  Grid3x3,
  Rocket,
  Sparkles,
  Star,
  Sun,
  Wind,
  Zap,
} from 'lucide-react'

const ICONS = {
  all: Grid3x3,
  'gift-boxes': Gift,
  sparklers: Sparkles,
  'flower-pots-fountains': Sun,
  'chakkars-wheels': CircleDot,
  bombs: Bomb,
  bijili: Zap,
  'rockets-shots': Rocket,
  'fancy-multi-shots': Star,
  novelty: Wind,
  others: Grid3x3,
}

export function getCategoryIcon(slug) {
  return ICONS[slug] ?? Grid3x3
}
