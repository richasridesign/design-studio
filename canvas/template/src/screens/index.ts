import type { ComponentType } from 'react';
import { People } from './People';
import { Invite } from './Invite';

// Every screen of the prototype, in flow order. The canvas reads this list to offer screens for new frames.
export const screens: { route: string; name: string; component: ComponentType }[] = [
  { route: '/', name: 'People', component: People },
  { route: '/invite', name: 'Invite people', component: Invite },
];
