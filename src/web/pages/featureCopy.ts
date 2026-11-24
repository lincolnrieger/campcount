import type { EventFeatures } from '../../shared/schemas';

export const FEATURE_COPY: Record<keyof EventFeatures, { label: string; hint: string }> = {
  activities: { label: 'Activity sign-in', hint: 'Leaders scan people in and out of activities.' },
  meals: { label: 'Meal scanning', hint: 'Count who has eaten at each meal.' },
  dietary: { label: 'Dietary requirements', hint: 'Allergy alerts at meal scans and a catering summary.' },
  site: { label: 'On-site tracking', hint: 'Scan leaders and participants on and off site.' },
  photo: { label: 'Photo consent markers', hint: 'Show a "No photos" marker when scanning people without consent.' },
  selfSignup: {
    label: 'Activity sign-up',
    hint: 'People book activity sessions themselves at a sign-up screen, from a session poster, or from their own lanyard QR.',
  },
  sideQuest: {
    label: 'Side Quest',
    hint: "A secret game: when someone opens a friend's lanyard QR on their own phone, they collect that friend. Their page shows how many they've collected and where they stand. Kids aren't told; they find it.",
  },
};
