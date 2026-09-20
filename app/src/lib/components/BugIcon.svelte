<script lang="ts">
  /** The bug on the report button, drawn with legs of its own so it can walk.
   *
   *  Lucide's `bug` is the same eleven strokes, but as one flat shape: the
   *  legs are siblings of the body and of each other, and nothing in it says
   *  where a leg meets the shell. That joint is the whole animation — a leg
   *  swings about the point it is attached at and about no other — so the
   *  drawing is kept and the six legs are given a class and an origin each.
   *
   *  Hovered, it walks the way a six-legged insect actually walks: the near
   *  front, the far middle and the near hind leg swing forward together while
   *  the other three push back, then the two sets trade. That alternating
   *  tripod is why an insect never falls over — three feet are on the ground
   *  at every instant, and they are always a triangle the body's weight sits
   *  inside. The swing is the quick half of each leg's cycle and the push is
   *  the long one, the swinging leg foreshortens a little because it is off
   *  the ground and we are looking down at it, and the body yaws a degree or
   *  two as the tripods trade, which is what the gait does to the insect.
   *
   *  It walks when whatever it sits in is hovered, not when the bug itself
   *  is: the bug is nineteen pixels inside a thirty-four pixel button, and a
   *  walk that cuts out while the pointer is still on the button reads as a
   *  fault rather than a flourish. Leaving pauses it where it stands rather
   *  than snapping the legs home — which is also what a bug does when you
   *  stop looking at it.
   */
  interface Props {
    /** Width and height in pixels; the stroke stays 2 units of the 24 either way. */
    size?: number;
  }

  let { size = 24 }: Props = $props();
</script>

<svg class="bug" width={size} height={size} viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <g class="whole">
    <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
    <path d="M12 20v-9" />
    <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
    <path class="feeler left" d="m8 2 1.88 1.88" />
    <path class="feeler right" d="M14.12 3.88 16 2" />
    <!-- One tripod is the left front, the right middle and the left hind leg;
         the other three carry the class that puts them half a stride behind. -->
    <path class="leg fore left" d="M3 5a4 4 0 0 0 3.55 3.97" />
    <path class="leg mid left off" d="M6 13H2" />
    <path class="leg hind left" d="M3 21a4 4 0 0 1 3.81-4" />
    <path class="leg fore right off" d="M21 5a4 4 0 0 1-3.55 3.97" />
    <path class="leg mid right" d="M22 13h-4" />
    <path class="leg hind right off" d="M21 21a4 4 0 0 0-3.81-4" />
  </g>
</svg>

<style>
  .bug {
    display: block;
    /* One stride, and whether any of this is moving. The play state is a
       variable because it inherits: one rule on the bug reaches the legs, the
       body and the feelers, and the hover that sets it is written once. */
    --stride: .58s;
    --walk: paused;
  }
  :global(:hover) > .bug,
  :global(:focus-visible) > .bug { --walk: running; }

  /* Every part turns about a point of the drawing rather than of its own
     bounding box: a leg's joint on the shell, a feeler's root on the head. */
  .leg, .feeler, .whole { transform-box: view-box; }

  .leg { animation: step var(--stride) linear infinite; }
  .leg.right { animation-name: step-mirror; }
  /* The far tripod is the near one, half a stride ago. */
  .leg.off { animation-delay: calc(var(--stride) / -2); }

  .leg.fore.left { transform-origin: 6.55px 8.97px; }
  .leg.mid.left { transform-origin: 6px 13px; }
  .leg.hind.left { transform-origin: 6.81px 17px; }
  .leg.fore.right { transform-origin: 17.45px 8.97px; }
  .leg.mid.right { transform-origin: 18px 13px; }
  .leg.hind.right { transform-origin: 17.19px 17px; }

  .whole { transform-origin: 12px 14px; animation: yaw var(--stride) ease-in-out infinite; }

  .feeler { animation: feel 1.9s ease-in-out infinite; }
  .feeler.left { transform-origin: 9.88px 3.88px; }
  /* Not a mirror of the left one: a pair of antennae that swept in lockstep
     would read as a machine. */
  .feeler.right { transform-origin: 14.12px 3.88px; animation-delay: -.72s; }

  /* Last, and after every `animation:` above: the shorthand sets the play
     state too, so anything that names one further down would start the bug
     walking on a page nobody has pointed at yet — which is how this was first
     written, and what the browser suite caught. */
  .leg, .feeler, .whole { animation-play-state: var(--walk); }

  /* A leg's cycle, from mid-push. Turning a left leg this way carries its
     foot towards the head, which is why the right legs run the mirror of it
     to reach forward at the same moment as their tripod. */
  @keyframes step {
    0% { rotate: 0deg; scale: 1; animation-timing-function: linear; }
    /* The foot ends up behind the body, having carried it forward. */
    30% { rotate: -12deg; scale: 1; animation-timing-function: cubic-bezier(.4, 0, 1, 1); }
    /* Lifted, halfway back to the front, and shortest seen from above. */
    50% { rotate: 0deg; scale: .92; animation-timing-function: cubic-bezier(0, 0, .6, 1); }
    /* Down again, reaching. */
    70% { rotate: 12deg; scale: 1; animation-timing-function: linear; }
    100% { rotate: 0deg; scale: 1; }
  }
  @keyframes step-mirror {
    0% { rotate: 0deg; scale: 1; animation-timing-function: linear; }
    30% { rotate: 12deg; scale: 1; animation-timing-function: cubic-bezier(.4, 0, 1, 1); }
    50% { rotate: 0deg; scale: .92; animation-timing-function: cubic-bezier(0, 0, .6, 1); }
    70% { rotate: -12deg; scale: 1; animation-timing-function: linear; }
    100% { rotate: 0deg; scale: 1; }
  }
  /* The body swings a little towards whichever tripod has the ground. */
  @keyframes yaw {
    0%, 100% { rotate: 0deg; }
    25% { rotate: 1.6deg; }
    75% { rotate: -1.6deg; }
  }
  @keyframes feel {
    0%, 100% { rotate: -8deg; }
    50% { rotate: 8deg; }
  }

  /* Asked for stillness, the bug is Lucide's bug and nothing moves. */
  @media (prefers-reduced-motion: reduce) {
    .bug,
    :global(:hover) > .bug,
    :global(:focus-visible) > .bug { --walk: paused; }
  }
</style>
