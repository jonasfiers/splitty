import {
  Utensils, UtensilsCrossed, ChefHat, Coffee, CupSoda, Beer, Wine, Martini, IceCreamCone, Pizza,
  Sandwich, Soup, Croissant, CakeSlice, Cookie, Apple, Carrot, Fish, Beef, Egg, Salad, Popcorn, Candy,
  Milk, Package, ShoppingBasket, ShoppingCart, Store,
  Plane, PlaneTakeoff, PlaneLanding, TrainFront, TrainFrontTunnel, TramFront, Bus, BusFront, Car,
  CarTaxiFront, Bike, Ship, Sailboat, Fuel, ParkingMeter, Route, Map as MapIcon, MapPin, Navigation, Compass,
  CableCar, Footprints, Luggage, Backpack, BaggageClaim, TicketsPlane,
  BedDouble, Bed, Hotel, House, Building, KeyRound, Tent, Caravan, TreePalm, Mountain, MountainSnow,
  WavesHorizontal, Umbrella, Sun, Snowflake, Sofa, Bath,
  ShoppingBag, Shirt, Gem, Glasses, Watch, Gift, Book, BookOpen, Laptop, Smartphone, Monitor,
  Headphones, Camera, Gamepad2, Plug, Wrench, Hammer, Paintbrush, Scissors, Sparkles,
  Ticket, Drama, Film, PartyPopper, Palette, Landmark, Castle, FerrisWheel, Dumbbell, Trophy, TreePine,
  Flower2, Dog, Cat, PawPrint, Baby, Dices, Puzzle,
  Zap, Droplet, Flame, Wifi, Phone, Receipt, FileText, CreditCard, Wallet, Banknote, Coins, PiggyBank,
  Percent, Shield, HeartPulse, Pill, Stethoscope, GraduationCap, Briefcase, Calendar, WashingMachine,
  Users, User, Heart, Rainbow, Star, Flag, Globe, Tag, Folder, Box,
  ArrowLeftRight, Handshake, Check, Image as ImageIcon, Paperclip, Search, Lock, CircleQuestionMark, Pencil, X, DoorOpen,
} from 'lucide'

// The icons people pick for categories, groups and trips (IconPicker), by
// section, with the words a search should find them by. Lucide (lucide.dev,
// ISC licence): line icons drawn on a 24-unit grid, the style the app's own
// navigation and settings icons already have. Stored by name ("train-front"),
// so a name here must never be renamed once in use. Only these are bundled.
const PICKABLE = [
  ['Food & drink', [
    ['utensils', Utensils, 'restaurant dinner lunch eat out food meal'],
    ['utensils-crossed', UtensilsCrossed, 'restaurant dinner food meal'],
    ['chef-hat', ChefHat, 'cooking kitchen chef'],
    ['coffee', Coffee, 'coffee cafe tea cake breakfast'],
    ['cup-soda', CupSoda, 'drink soda bubble tea take-away'],
    ['beer', Beer, 'bar pub beer drinks'],
    ['wine', Wine, 'wine bar drinks'],
    ['martini', Martini, 'cocktail bar drinks nightlife'],
    ['ice-cream-cone', IceCreamCone, 'ice cream dessert'],
    ['pizza', Pizza, 'pizza fast food'],
    ['sandwich', Sandwich, 'sandwich lunch snack'],
    ['soup', Soup, 'soup noodles ramen bowl'],
    ['croissant', Croissant, 'bakery bread breakfast'],
    ['cake-slice', CakeSlice, 'cake dessert bakery birthday'],
    ['cookie', Cookie, 'snack cookie sweets'],
    ['candy', Candy, 'sweets candy snack'],
    ['popcorn', Popcorn, 'snack cinema'],
    ['salad', Salad, 'salad healthy vegetarian'],
    ['beef', Beef, 'meat butcher barbecue'],
    ['fish', Fish, 'fish seafood sushi'],
    ['egg', Egg, 'breakfast egg'],
    ['apple', Apple, 'fruit groceries'],
    ['carrot', Carrot, 'vegetables groceries'],
    ['milk', Milk, 'milk dairy groceries'],
    ['package', Package, 'take-away delivery parcel box'],
    ['shopping-basket', ShoppingBasket, 'groceries supermarket basket'],
    ['shopping-cart', ShoppingCart, 'groceries supermarket cart'],
    ['store', Store, 'shop store market convenience'],
  ]],
  ['Transport', [
    ['plane', Plane, 'flight plane airport'],
    ['plane-takeoff', PlaneTakeoff, 'flight departure airport'],
    ['plane-landing', PlaneLanding, 'flight arrival airport'],
    ['tickets-plane', TicketsPlane, 'flight ticket booking'],
    ['train-front', TrainFront, 'train rail railway'],
    ['train-front-tunnel', TrainFrontTunnel, 'metro subway underground'],
    ['tram-front', TramFront, 'tram streetcar light rail'],
    ['bus', Bus, 'bus coach'],
    ['bus-front', BusFront, 'bus public transport'],
    ['car', Car, 'car drive rental'],
    ['car-taxi-front', CarTaxiFront, 'taxi uber cab ride'],
    ['bike', Bike, 'bike bicycle cycling'],
    ['ship', Ship, 'ferry boat ship cruise'],
    ['sailboat', Sailboat, 'boat sailing'],
    ['cable-car', CableCar, 'cable car gondola ski lift'],
    ['fuel', Fuel, 'fuel petrol gas diesel'],
    ['parking-meter', ParkingMeter, 'parking'],
    ['route', Route, 'route road trip journey'],
    ['navigation', Navigation, 'navigation directions'],
    ['compass', Compass, 'travel compass other transport'],
    ['footprints', Footprints, 'walk hike walking'],
  ]],
  ['Stays & trips', [
    ['bed-double', BedDouble, 'hotel stay accommodation room night'],
    ['bed', Bed, 'hostel bed stay'],
    ['hotel', Hotel, 'hotel accommodation'],
    ['house', House, 'house home rent airbnb holiday home'],
    ['building', Building, 'apartment flat city'],
    ['key-round', KeyRound, 'key rental check-in'],
    ['tent', Tent, 'camping tent campsite'],
    ['caravan', Caravan, 'caravan camper motorhome'],
    ['luggage', Luggage, 'trip luggage suitcase travel holiday'],
    ['backpack', Backpack, 'backpack trip travel'],
    ['baggage-claim', BaggageClaim, 'baggage luggage airport'],
    ['map', MapIcon, 'map trip travel'],
    ['map-pin', MapPin, 'place location pin'],
    ['globe', Globe, 'world travel abroad international'],
    ['tree-palm', TreePalm, 'beach holiday tropical'],
    ['umbrella', Umbrella, 'beach umbrella rain'],
    ['sun', Sun, 'summer sun holiday'],
    ['waves-horizontal', WavesHorizontal, 'sea beach swimming water'],
    ['mountain', Mountain, 'mountain hiking nature'],
    ['mountain-snow', MountainSnow, 'mountain ski snow winter'],
    ['snowflake', Snowflake, 'winter ski snow'],
  ]],
  ['Shopping', [
    ['shopping-bag', ShoppingBag, 'shopping bag store'],
    ['shirt', Shirt, 'clothes clothing fashion'],
    ['gem', Gem, 'jewellery jewelry'],
    ['glasses', Glasses, 'glasses optician'],
    ['watch', Watch, 'watch accessories'],
    ['gift', Gift, 'gift present birthday souvenir'],
    ['book', Book, 'books bookshop'],
    ['laptop', Laptop, 'it computer laptop electronics'],
    ['smartphone', Smartphone, 'phone mobile sim electronics'],
    ['monitor', Monitor, 'it computer screen'],
    ['headphones', Headphones, 'headphones audio music electronics'],
    ['camera', Camera, 'camera photo'],
    ['plug', Plug, 'adapter charger electronics'],
    ['wrench', Wrench, 'repair tools bike equipment maintenance'],
    ['hammer', Hammer, 'tools diy hardware'],
    ['paintbrush', Paintbrush, 'paint diy'],
    ['scissors', Scissors, 'hairdresser barber'],
    ['sparkles', Sparkles, 'beauty cosmetics cleaning'],
    ['sofa', Sofa, 'furniture home'],
  ]],
  ['Leisure', [
    ['ticket', Ticket, 'tickets activity entrance museum leisure'],
    ['drama', Drama, 'theatre theater show'],
    ['film', Film, 'cinema movie film'],
    ['party-popper', PartyPopper, 'party celebration event'],
    ['palette', Palette, 'art gallery museum'],
    ['landmark', Landmark, 'museum sightseeing monument'],
    ['castle', Castle, 'castle sightseeing'],
    ['ferris-wheel', FerrisWheel, 'theme park fair'],
    ['dumbbell', Dumbbell, 'gym sport fitness'],
    ['trophy', Trophy, 'sport game match'],
    ['gamepad-2', Gamepad2, 'games gaming'],
    ['dices', Dices, 'board games'],
    ['puzzle', Puzzle, 'games puzzle'],
    ['book-open', BookOpen, 'reading course'],
    ['tree-pine', TreePine, 'nature park forest'],
    ['flower-2', Flower2, 'flowers garden'],
    ['bath', Bath, 'spa wellness bath'],
  ]],
  ['Home & bills', [
    ['zap', Zap, 'electricity energy power'],
    ['droplet', Droplet, 'water'],
    ['flame', Flame, 'gas heating'],
    ['wifi', Wifi, 'internet wifi'],
    ['phone', Phone, 'phone subscription'],
    ['washing-machine', WashingMachine, 'laundry'],
    ['receipt', Receipt, 'bill receipt invoice'],
    ['file-text', FileText, 'document fees admin'],
    ['credit-card', CreditCard, 'card payment fees'],
    ['wallet', Wallet, 'wallet cash money'],
    ['banknote', Banknote, 'cash money'],
    ['coins', Coins, 'coins tips money'],
    ['piggy-bank', PiggyBank, 'savings'],
    ['percent', Percent, 'tax discount'],
    ['shield', Shield, 'insurance'],
    ['heart-pulse', HeartPulse, 'health medical'],
    ['pill', Pill, 'pharmacy medicine'],
    ['stethoscope', Stethoscope, 'doctor medical'],
    ['graduation-cap', GraduationCap, 'school education study'],
    ['briefcase', Briefcase, 'work business'],
    ['calendar', Calendar, 'event subscription'],
  ]],
  ['People & other', [
    ['users', Users, 'group friends people family'],
    ['user', User, 'person'],
    ['heart', Heart, 'love couple'],
    ['rainbow', Rainbow, 'rainbow pride colourful'],
    ['baby', Baby, 'baby kids children'],
    ['dog', Dog, 'dog pet'],
    ['cat', Cat, 'cat pet'],
    ['paw-print', PawPrint, 'pet animal'],
    ['star', Star, 'favourite star'],
    ['flag', Flag, 'flag country'],
    ['tag', Tag, 'tag label other'],
    ['folder', Folder, 'folder other'],
    ['box', Box, 'box moving storage'],
  ]],
]

// Icons the app draws itself (not pickable).
const UI = {
  'arrow-left-right': ArrowLeftRight,
  handshake: Handshake,
  check: Check,
  image: ImageIcon,
  paperclip: Paperclip,
  search: Search,
  lock: Lock,
  'circle-question-mark': CircleQuestionMark,
  pencil: Pencil,
  x: X,
  'door-open': DoorOpen,
}

const NODES = new Map(Object.entries(UI))
const PICKABLE_SECTIONS = PICKABLE.map(([section, icons]) => ({
  section,
  icons: icons.map(([name, node, keywords]) => {
    NODES.set(name, node)
    return { name, label: name.replace(/-/g, ' '), keywords }
  }),
}))

// Countries, as their two-letter ISO code ("country:TW"), drawn as the letters
// in place of a flag (Icon.jsx): line icons have no flags, and at icon size
// the code reads better than most flags would. Names come from the browser
// (Intl), in its language, and in English for the search.
const COUNTRY_CODES = [
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS',
  'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE',
  'EG EH ER ES ET EU FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK',
  'HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB',
  'LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ',
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU',
  'RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN',
  'TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW',
].join(' ').split(' ')
const COUNTRIES = new Set(COUNTRY_CODES)
const regionNames = lang => { try { return new Intl.DisplayNames([lang, 'en'], { type: 'region' }) } catch { return null } }
const localNames = regionNames(globalThis.navigator?.language || 'en')
const englishNames = regionNames('en')
export const countryName = code => localNames?.of(code) ?? englishNames?.of(code) ?? code

// 'country:TW' -> 'TW', for a code we know; else null.
export const countryOf = name => {
  const code = typeof name === 'string' && name.startsWith('country:') ? name.slice(8) : null
  return code && COUNTRIES.has(code) ? code : null
}

export const ICON_SECTIONS = [
  ...PICKABLE_SECTIONS,
  {
    section: 'Countries',
    icons: COUNTRY_CODES
      .map(code => ({ name: `country:${code}`, label: countryName(code), keywords: `${code} ${englishNames?.of(code) ?? ''} country`.toLowerCase() }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  },
]

export const iconNode = name => (name ? NODES.get(name) ?? null : null)
export const isIcon = name => NODES.has(name) || countryOf(name) != null
export const iconLabel = name => (countryOf(name) ? countryName(countryOf(name)) : name.replace(/-/g, ' '))

// An icon as an SVG string, for HTML built outside React (map pins).
const attr = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
export function iconSvg(name, { size = 16, strokeWidth = 2 } = {}) {
  const country = countryOf(name)
  const node = iconNode(name)
  if (!node && !country) return ''
  const children = country
    ? `<text x="12" y="12.5" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="800" fill="currentColor" stroke="none">${country}</text>`
    : node.map(([tag, attrs]) =>
      `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${attr(v)}"`).join(' ')}/>`).join('')
  return `<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`
}

// A stored icon (category, group, trip) if it is one of ours, else `fallback`.
export const iconOr = (name, fallback = null) => (isIcon(name) ? name : fallback)
