import {
  AppWindow,
  Atom,
  BookOpen,
  BookOpenText,
  Brush,
  Church,
  Code2,
  Cuboid,
  FileText,
  FlaskConical,
  Folder,
  Gamepad2,
  Globe2,
  GraduationCap,
  Landmark,
  Languages,
  Leaf,
  ListChecks,
  Music,
  Palette,
  Presentation,
  School,
  Sigma,
  Star,
  Trophy,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { CollectionIcon, LibraryItemType, SubjectIcon, ViewerKind } from '@/types/models';

interface TypeMeta {
  label: string;
  plural: string;
  icon: LucideIcon;
  verb: string;
  continueVerb: string;
  /** two hues used by the generated artwork */
  hues: [number, number];
  viewer: ViewerKind;
}

export const TYPE_META: Record<LibraryItemType, TypeMeta> = {
  game: { label: 'Game', plural: 'Games', icon: Gamepad2, verb: 'Play', continueVerb: 'Play again', hues: [262, 320], viewer: 'game' },
  learning: { label: 'Learning', plural: 'Learning materials', icon: GraduationCap, verb: 'Read', continueVerb: 'Continue reading', hues: [205, 250], viewer: 'reader' },
  app: { label: 'App', plural: 'Apps', icon: AppWindow, verb: 'Open', continueVerb: 'Open again', hues: [230, 190], viewer: 'app' },
  tool: { label: 'Tool', plural: 'Tools', icon: Wrench, verb: 'Open', continueVerb: 'Open again', hues: [28, 345], viewer: 'app' },
  simulation: { label: 'Simulation', plural: 'Simulations', icon: Atom, verb: 'Run', continueVerb: 'Run again', hues: [165, 215], viewer: 'simulation' },
  presentation: { label: 'Presentation', plural: 'Presentations', icon: Presentation, verb: 'Present', continueVerb: 'Present again', hues: [42, 12], viewer: 'presentation' },
  document: { label: 'Document', plural: 'Documents', icon: FileText, verb: 'Read', continueVerb: 'Continue reading', hues: [220, 260], viewer: 'document' },
  quiz: { label: 'Quiz', plural: 'Quizzes', icon: ListChecks, verb: 'Start', continueVerb: 'Practice again', hues: [140, 95], viewer: 'reader' },
};

export const SUBJECT_ICONS: Record<SubjectIcon, LucideIcon> = {
  sigma: Sigma,
  atom: Atom,
  code: Code2,
  languages: Languages,
  landmark: Landmark,
  church: Church,
  leaf: Leaf,
  flask: FlaskConical,
  book: BookOpen,
  globe: Globe2,
  music: Music,
  palette: Palette,
};

export const COLLECTION_ICONS: Record<CollectionIcon, LucideIcon> = {
  folder: Folder,
  star: Star,
  gamepad: Gamepad2,
  book: BookOpenText,
  flask: FlaskConical,
  brush: Brush,
  trophy: Trophy,
  cube: Cuboid,
  school: School,
  code: Code2,
};

export const SWATCHES = ['#A78BFA', '#7AA2F7', '#5DD5A2', '#F6C76A', '#F08091', '#F59E6B', '#5CC8E0', '#E58AD6', '#9CA3AF'];

export const SUGGESTED_SUBJECTS: { name: string; icon: SubjectIcon; color: string; description: string }[] = [
  { name: 'Mathematik', icon: 'sigma', color: '#7AA2F7', description: 'Analysis, Geometrie, Stochastik und Algebra.' },
  { name: 'Physik', icon: 'atom', color: '#5CC8E0', description: 'Mechanik, Elektrizität, Optik und Wellen.' },
  { name: 'Informatik', icon: 'code', color: '#A78BFA', description: 'Algorithmen, Programmierung und Datenstrukturen.' },
  { name: 'Englisch', icon: 'languages', color: '#F08091', description: 'Vocabulary, grammar, texts and speaking.' },
  { name: 'Französisch', icon: 'languages', color: '#E58AD6', description: 'Vocabulaire, grammaire et compréhension.' },
  { name: 'Geschichte', icon: 'landmark', color: '#F6C76A', description: 'Epochen, Quellen und Zusammenhänge.' },
  { name: 'Religion', icon: 'church', color: '#F59E6B', description: 'Ethik, Weltreligionen und Philosophie.' },
  { name: 'Biologie', icon: 'leaf', color: '#5DD5A2', description: 'Zellen, Genetik, Ökologie und Evolution.' },
  { name: 'Chemie', icon: 'flask', color: '#9BE38B', description: 'Reaktionen, Stoffe und Modelle.' },
];
