// Check how the local model drafts emails/events (nothing is sent; Google must not be required).
// Usage: node scripts/eval-actions.js
import * as google from '../src/google.js';
import { draftAction } from '../src/actions.js';

if (!google.googleReady()) console.log('(Google not connected: drafts below use a fake "connected" check)\n');

for (const request of [
  "add movie night at Hana's to my calendar tonight 8:45pm at D61 Stone Park",
  'send an email to alex@example.com saying I will be 30 minutes late to the 11am meeting tomorrow',
  'email Nada the movie list',
  'remind me to call mom tomorrow at 5pm',
]) {
  console.log(`\n> ${request}\n${await draftAction(request, [], { skipGoogleCheck: true })}`);
}
