'use strict';

const crypto = require('node:crypto');

const { VALID_THEME_TAGS } = require('./_shared');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_AUDIENCE_FOCUS = new Set(['buyers', 'sellers', 'both']);

const VALID_BEST_SUITED_FOR = new Set(['reel', 'blog']);

const WEEK_ISO_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

// ── Topic bank ────────────────────────────────────────────────────────────────
//
// Sourceless entries only. facts is always [] and sourceFooter is always null
// in this commit. A later commit adds cited entries with hand-verified facts.

const TOPIC_BANK = [
  {
    id: 'listing-photos',
    themeTag: 'craft',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'wide-lens',
        take: 'Photos taken with an ultra wide lens make a room look bigger than it will feel the moment you walk in.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.68,
      },
      {
        id: 'staged-vs-lived',
        take: 'The listing photo you love is staged for the camera, not for how you will actually live in the space.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.61,
      },
      {
        id: 'seller-photo-choice',
        take: 'A seller who skips professional photos is quietly signaling how much they value first impressions.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.55,
      },
    ],
  },
  {
    id: 'showing-etiquette',
    themeTag: 'process',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'buyer-manners',
        take: 'Showing up late or overstaying a showing tells the seller more about you than you think.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.52,
      },
      {
        id: 'seller-prep',
        take: 'A seller who leaves the home spotless for every showing is negotiating before an offer even arrives.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.58,
      },
      {
        id: 'seller-scarce',
        take: 'Buyers relax and picture themselves living there only when the seller is nowhere in the house during a showing.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.60,
      },
    ],
  },
  {
    id: 'first-offer-tone',
    themeTag: 'buyer_psychology',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'anchor-effect',
        take: 'The first offer on a home quietly becomes the anchor every later offer gets measured against.',
        audienceFocus: 'both',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.74,
      },
      {
        id: 'lowball-risk',
        take: 'A lowball first offer can end a negotiation before it starts, even when the buyer meant it as an opener.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.63,
      },
      {
        id: 'clean-beats-high',
        take: 'A clean offer with fewer conditions often beats a higher one that drags a pile of escape hatches behind it.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.66,
      },
    ],
  },
  {
    id: 'home-not-selling',
    themeTag: 'seller_psychology',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'overpricing-tell',
        take: 'A home that gets showings but no offers is being priced by hope instead of by the market.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.71,
      },
      {
        id: 'stale-listing',
        take: 'The longer a listing sits, the more buyers assume something is wrong with it, whether or not that is true.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.66,
      },
      {
        id: 'feedback-silence',
        take: 'When showings happen but no offers follow, the market is usually telling you the price, not the house.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.64,
      },
    ],
  },
  {
    id: 'open-house-reality',
    themeTag: 'process',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'browser-vs-buyer',
        take: 'The people walking through an open house are often curious neighbours, not buyers, and that is fine.',
        audienceFocus: 'both',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.49,
      },
      {
        id: 'agent-read',
        take: 'An agent hosting an open house is reading body language more than answering questions.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.54,
      },
      {
        id: 'neighbour-recon',
        take: 'Many of the people walking through an open house live nearby and just want to see what your place looks like inside.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.58,
      },
    ],
  },
  {
    id: 'what-agents-notice',
    themeTag: 'craft',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'smell-test',
        take: 'An agent walks in and notices smell before anything else, because buyers do too even if they will not say it.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.63,
      },
      {
        id: 'traffic-flow',
        take: 'Agents notice how a home flows room to room long before they notice the finishes.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.57,
      },
      {
        id: 'deferred-clues',
        take: 'A good agent reads the small deferred repairs as a hint about everything you cannot see behind the walls.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.62,
      },
    ],
  },
  {
    id: 'declutter-vs-staging',
    themeTag: 'craft',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'declutter-first',
        take: 'Decluttering costs nothing and does more for a showing than most staging ever will.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.60,
      },
      {
        id: 'staging-purpose',
        take: 'Staging is not about making a home beautiful, it is about helping a stranger imagine living there.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.65,
      },
      {
        id: 'empty-reads-cold',
        take: 'A fully empty room can read cold and small, while a lightly staged one gives buyers a sense of scale.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.60,
      },
    ],
  },
  {
    id: 'first-home-emotional-trap',
    themeTag: 'buyer_psychology',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'falling-for-first',
        take: 'Falling for the first home you tour makes every home after it look worse by comparison.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.72,
      },
      {
        id: 'comparison-trap',
        take: 'The home you end up buying is rarely the one that felt most exciting on the first walkthrough.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.59,
      },
      {
        id: 'weekend-rush',
        take: 'The pressure to decide by the weekend is almost never about the house and almost always about your own nerves.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.63,
      },
    ],
  },
  {
    id: 'preapproval-vs-prequalification',
    themeTag: 'process',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'concept-gap',
        take: 'Pre-qualification is a guess based on what you tell a lender, pre-approval is a lender actually checking it.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.56,
      },
      {
        id: 'false-confidence',
        take: 'Walking into a showing with only a pre-qualification is walking in with a number nobody has verified.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.61,
      },
      {
        id: 'paper-weight',
        take: 'A prequalification is a friendly guess, a preapproval is the one a seller actually takes seriously.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.61,
      },
    ],
  },
  {
    id: 'closing-day',
    themeTag: 'process',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'what-actually-happens',
        take: 'Closing day is mostly paperwork and waiting, not the dramatic key handoff people picture.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['blog'],
        longFormSuitable: true,
        baseInterest: 0.48,
      },
      {
        id: 'last-minute-walkthrough',
        take: 'The final walkthrough exists to confirm the home is still the home you agreed to buy, nothing more.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.53,
      },
      {
        id: 'keys-delay',
        take: 'The keys often come later in the day than people expect, because the money has to land before anything is truly yours.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.57,
      },
    ],
  },
  {
    id: 'condo-vs-freehold',
    themeTag: 'costs',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'fee-tradeoff',
        take: 'A condo fee buys predictability, a freehold roof buys control, and pretending one is strictly better than the other is dishonest.',
        audienceFocus: 'both',
        bestSuitedFor: ['blog'],
        longFormSuitable: true,
        baseInterest: 0.55,
      },
      {
        id: 'freehold-illusion',
        take: 'Freehold ownership does not mean zero shared cost, it means the shared cost shows up unpredictably instead of monthly.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.62,
      },
      {
        id: 'fee-buys-time',
        take: 'A condo fee is really buying back your weekends, since someone else handles the roof, the lawn, and the snow.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.60,
      },
    ],
  },
  {
    id: 'neighbourhood-time-of-day',
    themeTag: 'buyer_psychology',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'night-visit',
        take: 'A neighbourhood that feels perfect at an afternoon showing can feel completely different on a weeknight.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.70,
      },
      {
        id: 'commute-test',
        take: 'Driving the commute once on a weekend tells you nothing about what that commute is like on a weekday morning.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.64,
      },
      {
        id: 'weekday-vs-weekend',
        take: 'A street that feels calm on a Sunday can turn into a cut-through the second Monday rush hour starts.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.62,
      },
    ],
  },
  {
    id: 'renovation-payback-myths',
    themeTag: 'costs',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'kitchen-myth',
        take: 'A renovated kitchen makes a home easier to sell, it does not automatically return what you spent on it.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.67,
      },
      {
        id: 'upgrade-vs-taste',
        take: 'The upgrade you love might be the exact finish a buyer wants to rip out, and that mismatch is normal.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.58,
      },
      {
        id: 'over-improve',
        take: 'You can renovate past your own street, and the block sets a ceiling your finishes cannot climb over.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.61,
      },
    ],
  },
  {
    id: 'list-price-not-value',
    themeTag: 'seller_psychology',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'price-as-strategy',
        take: 'List price is a strategy decision, not a statement of what the home is worth.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.69,
      },
      {
        id: 'underpricing-tactic',
        take: 'Pricing a home under what the seller wants can be the exact move that gets them more than asking.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.73,
      },
      {
        id: 'list-is-bait',
        take: 'A list price is a marketing decision, not an appraisal, and the two can sit far apart on purpose.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.63,
      },
    ],
  },
  {
    id: 'bidding-war-psychology',
    themeTag: 'buyer_psychology',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'fomo-escalation',
        take: 'A bidding war turns a home purchase into a competition, and competitions make people pay for winning, not for the home.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.78,
      },
      {
        id: 'walk-away-power',
        take: 'The buyer willing to walk away from a bidding war usually has more leverage than the one who cannot picture losing it.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.65,
      },
      {
        id: 'ceiling-first',
        take: 'Decide your true ceiling before the offer night, because nobody thinks clearly once the war has already started.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.65,
      },
    ],
  },
  {
    id: 'home-inspection-scope',
    themeTag: 'process',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'what-it-covers',
        take: 'A home inspection tells you what is wrong with what the inspector can see, not what is hidden behind a wall.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.60,
      },
      {
        id: 'not-a-guarantee',
        take: 'Passing an inspection is not a guarantee, it is a snapshot of the day someone walked through with a flashlight.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.56,
      },
      {
        id: 'visual-only',
        take: 'An inspector reports on what can be seen and reached, not on what sits sealed inside a wall or buried under the yard.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['blog'],
        longFormSuitable: true,
        baseInterest: 0.57,
      },
    ],
  },
  {
    id: 'status-certificate',
    themeTag: 'regulation',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'what-it-is',
        take: 'A status certificate is the document that tells a condo buyer what they are actually buying into financially and legally.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['blog'],
        longFormSuitable: true,
        baseInterest: 0.50,
      },
      {
        id: 'lawyer-review',
        take: 'Skipping a lawyer review of the status certificate is one of the most avoidable risks in a condo purchase.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.61,
      },
      {
        id: 'reserve-fund-signal',
        take: 'Buried in the status certificate is the reserve fund, and a thin one hints at special assessments landing on you later.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['blog'],
        longFormSuitable: true,
        baseInterest: 0.56,
      },
    ],
  },
  {
    id: 'moving-day-logistics',
    themeTag: 'process',
    months: [5, 6, 7, 8, 9],
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'elevator-booking',
        take: 'Booking the elevator and parking before moving day matters more than most people plan for.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.45,
      },
      {
        id: 'overlap-week',
        take: 'The week where you hold two homes at once is the most stressful part of moving that nobody warns you about.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.52,
      },
      {
        id: 'book-early',
        take: 'The good movers in your area are spoken for weeks ahead once the busy season starts, so the calendar matters more than the price.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.55,
      },
      {
        id: 'possession-gap',
        take: 'When your sale closes and your purchase closes on different days, you need a plan for the nights in between.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.56,
      },
    ],
  },
  {
    id: 'offer-date-game',
    themeTag: 'seller_psychology',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'artificial-deadline',
        take: 'Setting an offer date is a seller strategy to create urgency, not a rule buyers have to follow.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.66,
      },
      {
        id: 'preemptive-offer',
        take: 'A strong offer made before the offer date can end the whole process before the bidding war ever starts.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.72,
      },
      {
        id: 'hold-back-risk',
        take: 'Holding offers to a set date can backfire if the market cools, because the best buyer might not wait around for your calendar.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.61,
      },
    ],
  },
  {
    id: 'preapproval-first',
    themeTag: 'process',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'agent-request',
        take: 'An agent asking for a pre-approval before showings is protecting your time as much as their own.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.47,
      },
      {
        id: 'serious-signal',
        take: 'Showing up pre-approved signals to a seller that an offer is real, not a maybe.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.51,
      },
      {
        id: 'rate-hold',
        take: 'A preapproval can lock a rate for a stretch of weeks, which quietly protects your budget while you shop.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.58,
      },
    ],
  },
  {
    id: 'seller-disclosure',
    themeTag: 'regulation',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'what-must-be-disclosed',
        take: 'A seller must disclose known material defects, not every flaw they have ever noticed about the home.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['blog'],
        longFormSuitable: true,
        baseInterest: 0.53,
      },
      {
        id: 'buyer-assumption',
        take: 'Buyers often assume disclosure covers more than it legally does, and that gap is where disputes start.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.60,
      },
      {
        id: 'silence-is-risk',
        take: 'In Ontario a seller who stays silent about a hidden defect they knew of is taking on more risk than they think.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.59,
      },
    ],
  },
  {
    id: 'pricing-psychology',
    themeTag: 'seller_psychology',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'charm-pricing',
        take: 'Ending a list price just under a round number is a psychology trick, not a market signal.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.55,
      },
      {
        id: 'price-as-invitation',
        take: 'A price set slightly low can act as an invitation to bid rather than a discount.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.63,
      },
      {
        id: 'round-number-signal',
        take: 'A crisp round asking price can read as confidence, while an odd one can read as a plea for a deal.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.60,
      },
    ],
  },
  {
    id: 'curb-appeal',
    themeTag: 'craft',
    months: [3, 4, 5],
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'first-impression',
        take: 'A buyer forms an opinion about a home before they get out of the car, curb appeal negotiates on your behalf before anyone says a word.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.68,
      },
      {
        id: 'cheap-fixes',
        take: 'The cheapest curb appeal fixes, a clean walkway and a tidy lawn, do more work than people expect.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.57,
      },
      {
        id: 'door-and-numbers',
        take: 'A fresh front door and clean house numbers do more for the first photo than most of what you spend inside.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.63,
      },
      {
        id: 'driveway-frame',
        take: 'Buyers form an opinion before they leave the car, so the driveway and the walk up matter as much as the foyer.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.61,
      },
      {
        id: 'spring-yard',
        take: 'A tidy spring yard with a little colour signals a house that has been cared for all year.',
        audienceFocus: 'sellers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.58,
      },
    ],
  },
  {
    id: 'sold-firm-vs-conditional',
    themeTag: 'regulation',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'what-it-means',
        take: 'Sold firm means the deal is done, sold conditional means it can still fall apart.',
        audienceFocus: 'both',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.59,
      },
      {
        id: 'why-it-matters',
        take: 'A home marked sold conditional can come back on the market, which is why some buyers keep watching it anyway.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.54,
      },
      {
        id: 'still-in-play',
        take: 'A sold conditional sign does not always mean the race is over, since a conditional deal can still fall apart.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.60,
      },
    ],
  },
  {
    id: 'true-cost-of-waiting',
    themeTag: 'costs',
    months: null,
    facts: [],
    sourceFooter: null,
    angleSeeds: [
      {
        id: 'opportunity-cost',
        take: 'Waiting for the perfect home has a cost too, it just does not show up on a bill.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.64,
      },
      {
        id: 'rent-vs-carry',
        take: 'The cost of waiting to buy is not just a missed home, it is however many more months of rent that build no equity.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel', 'blog'],
        longFormSuitable: true,
        baseInterest: 0.70,
      },
      {
        id: 'rate-vs-price',
        take: 'Waiting for prices to dip can cost you if rates climb in the meantime, since the monthly payment is what you actually live with.',
        audienceFocus: 'buyers',
        bestSuitedFor: ['reel'],
        longFormSuitable: false,
        baseInterest: 0.62,
      },
    ],
  },
];

// ── validateEntry ─────────────────────────────────────────────────────────────

function validateEntry(entry) {
  if (entry == null || typeof entry !== 'object') {
    return ['entry must be a non-null object'];
  }

  const errors = [];

  // id
  if (typeof entry.id !== 'string' || entry.id.trim() === '') {
    errors.push('id: required non-empty string');
  }

  // themeTag
  if (!VALID_THEME_TAGS.has(entry.themeTag)) {
    errors.push(`themeTag: must be one of ${[...VALID_THEME_TAGS].join(', ')}`);
  }

  // months
  if (entry.months !== null) {
    const monthsValid = Array.isArray(entry.months) &&
      entry.months.length > 0 &&
      entry.months.every(m => Number.isInteger(m) && m >= 1 && m <= 12);
    if (!monthsValid) {
      errors.push('months: must be null or a non-empty array of integers from 1 to 12');
    }
  }

  // facts / sourceFooter
  if (!Array.isArray(entry.facts)) {
    errors.push('facts: must be an array');
  } else if (entry.facts.length === 0 && entry.sourceFooter !== null) {
    errors.push('sourceFooter: must be null when facts is empty');
  }

  // angleSeeds
  if (!Array.isArray(entry.angleSeeds) || entry.angleSeeds.length === 0) {
    errors.push('angleSeeds: required non-empty array');
  } else {
    const seedIds = new Set();
    for (let i = 0; i < entry.angleSeeds.length; i++) {
      const seed = entry.angleSeeds[i];

      if (seed == null || typeof seed !== 'object') {
        errors.push(`angleSeeds[${i}]: must be an object`);
        continue;
      }

      if (typeof seed.id !== 'string' || seed.id.trim() === '') {
        errors.push(`angleSeeds[${i}].id: required non-empty string`);
      } else if (seedIds.has(seed.id)) {
        errors.push(`angleSeeds[${i}].id: duplicate seed id "${seed.id}" within entry`);
      } else {
        seedIds.add(seed.id);
      }

      if (typeof seed.take !== 'string' || seed.take.trim() === '') {
        errors.push(`angleSeeds[${i}].take: required non-empty string`);
      }

      if (!VALID_AUDIENCE_FOCUS.has(seed.audienceFocus)) {
        errors.push(`angleSeeds[${i}].audienceFocus: must be one of ${[...VALID_AUDIENCE_FOCUS].join(', ')}`);
      }

      if (!Array.isArray(seed.bestSuitedFor) || seed.bestSuitedFor.length === 0) {
        errors.push(`angleSeeds[${i}].bestSuitedFor: required non-empty array`);
      } else {
        for (let j = 0; j < seed.bestSuitedFor.length; j++) {
          if (!VALID_BEST_SUITED_FOR.has(seed.bestSuitedFor[j])) {
            errors.push(`angleSeeds[${i}].bestSuitedFor[${j}]: must be one of ${[...VALID_BEST_SUITED_FOR].join(', ')}`);
          }
        }
      }

      if (typeof seed.longFormSuitable !== 'boolean') {
        errors.push(`angleSeeds[${i}].longFormSuitable: must be a boolean`);
      }

      if (typeof seed.baseInterest !== 'number' || seed.baseInterest < 0 || seed.baseInterest > 1) {
        errors.push(`angleSeeds[${i}].baseInterest: must be a number between 0 and 1 inclusive`);
      }
    }
  }

  return errors;
}

// ── listSlots ─────────────────────────────────────────────────────────────────

function slotSortKey(topicId, seedId) {
  return crypto.createHash('sha256').update(`${topicId}:${seedId}`).digest('hex');
}

function listSlots(entries) {
  const slots = [];
  for (const entry of entries) {
    for (const seed of entry.angleSeeds) {
      slots.push({ topicId: entry.id, seedId: seed.id, entry, seed });
    }
  }

  slots.sort((a, b) => {
    const ka = slotSortKey(a.topicId, a.seedId);
    const kb = slotSortKey(b.topicId, b.seedId);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });

  return slots;
}

// ── ISO week Thursday month ───────────────────────────────────────────────────

function isoWeekThursdayMonth(weekIso) {
  const [yearStr, weekStr] = weekIso.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);

  // Jan 4 is always in ISO week 1. Find week-1 Monday, then walk to Thursday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4IsoWeekday = (jan4.getUTCDay() + 6) % 7 + 1; // 1=Mon .. 7=Sun
  const week1Monday = new Date(jan4.getTime() - (jan4IsoWeekday - 1) * 86400000);
  const thursday = new Date(week1Monday.getTime() + ((week - 1) * 7 + 3) * 86400000);

  return thursday.getUTCMonth() + 1;
}

// ── epochDeck ─────────────────────────────────────────────────────────────────
//
// Deterministic hash shuffle of slots for one epoch. Sorts a COPY; the input
// array is never mutated.

function epochDeckSortKey(epoch, bankVer, topicId, seedId) {
  return crypto.createHash('sha256').update(`${epoch}:${bankVer}:${topicId}:${seedId}`).digest('hex');
}

function epochDeck(slots, epoch, bankVer) {
  const deck = slots.slice();

  deck.sort((a, b) => {
    const ka = epochDeckSortKey(epoch, bankVer, a.topicId, a.seedId);
    const kb = epochDeckSortKey(epoch, bankVer, b.topicId, b.seedId);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });

  return deck;
}

// ── selectWeeklyTopics ────────────────────────────────────────────────────────
//
// Deals from a per-epoch deterministic deck rather than an arithmetic cursor,
// so the mechanism stays correct at any count and any bank size (an
// arithmetic cursor is only well-behaved when gcd(count, slots.length) == 1,
// which is an accident of bank size, not a guarantee). Consecutive weeks
// within an epoch deal disjoint consecutive windows of the shuffled deck.
// Seasonality is applied BEFORE windowing (filtering the deck down to
// in-season slots first, then windowing over that filtered list) so a
// filtered-out slot cannot cause the deal window to overrun into the next
// week's window. Topic dedupe can still skip forward within a window, which
// is rare and accepted.

function selectWeeklyTopics(weekIso, count, opts = {}) {
  if (typeof weekIso !== 'string' || !WEEK_ISO_RE.test(weekIso)) {
    throw new TypeError(`selectWeeklyTopics: malformed weekIso "${weekIso}"`);
  }

  const entries = opts.entries || TOPIC_BANK;
  const slots = listSlots(entries);
  if (slots.length === 0 || count <= 0) return [];

  const [yearStr, weekStr] = weekIso.split('-W');
  const year = parseInt(yearStr, 10);
  const weekNumber = parseInt(weekStr, 10);
  const month = isoWeekThursdayMonth(weekIso);

  const absWeek = year * 53 + weekNumber;
  const epochLength = Math.ceil(slots.length / count);
  const epoch = Math.floor(absWeek / epochLength);
  const offset = absWeek % epochLength;
  const bankVer = bankVersionOf(entries);
  const deck = epochDeck(slots, epoch, bankVer);

  const inSeason = deck.filter(s =>
    s.entry.months === null || s.entry.months.includes(month));
  if (inSeason.length === 0) return [];
  const start = (offset * count) % inSeason.length;

  const result = [];
  const usedTopicIds = new Set();

  for (let i = 0; i < inSeason.length && result.length < count; i++) {
    const slot = inSeason[(start + i) % inSeason.length];

    if (usedTopicIds.has(slot.topicId)) continue;

    result.push(slot);
    usedTopicIds.add(slot.topicId);
  }

  return result;
}

// ── bankVersion ───────────────────────────────────────────────────────────────

function stableStringify(val) {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(val[k])).join(',') + '}';
}

function bankVersionOf(entries) {
  return crypto.createHash('sha256').update(stableStringify(entries)).digest('hex').slice(0, 16);
}

function bankVersion() {
  return bankVersionOf(TOPIC_BANK);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  TOPIC_BANK,
  validateEntry,
  listSlots,
  selectWeeklyTopics,
  bankVersion,
  _internal: {
    stableStringify,
    epochDeck,
  },
};
