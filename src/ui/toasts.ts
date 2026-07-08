// ── Toasts + first-run tutorial ─────────────────────────────────────────────
import { World } from '../sim/world';

export class Toasts {
  private container: HTMLElement;
  private hint: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.hint = document.createElement('div');
    this.hint.className = 'tutorial-hint hidden';
    document.body.appendChild(this.hint);
  }

  show(msg: string, kind: 'info' | 'warn' | 'good' = 'info', ms = 6000): void {
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = msg;
    this.container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-in'));
    window.setTimeout(() => {
      el.classList.remove('toast-in');
      window.setTimeout(() => el.remove(), 400);
    }, ms);
    // cap stack size
    while (this.container.children.length > 5) this.container.firstChild?.remove();
  }

  drainEvents(world: World): void {
    for (const e of world.events.splice(0)) {
      this.show(e.msg, e.kind, e.kind === 'warn' ? 7000 : 6000);
    }
  }

  updateTutorial(world: World): void {
    const st = world.state;
    const steps = TUTORIAL_STEPS;
    if (st.tutorialStep >= steps.length) {
      this.hint.classList.add('hidden');
      return;
    }
    const step = steps[st.tutorialStep];
    if (step.done(world)) {
      st.tutorialStep++;
      if (st.tutorialStep < steps.length) {
        this.show('✓ ' + step.shortDone, 'good', 3500);
      } else {
        this.show('Tutorial complete. Chase the Carnot ceiling!', 'good', 6000);
        this.hint.classList.add('hidden');
      }
      return;
    }
    this.hint.classList.remove('hidden');
    const label = `${st.tutorialStep + 1}/${steps.length}`;
    if (this.hint.dataset.step !== label) {
      this.hint.dataset.step = label;
      this.hint.innerHTML = `<span class="hint-step">${label}</span> ${step.text}`;
    }
  }
}

interface TutorialStep {
  text: string;
  shortDone: string;
  /** build-menu entry keys to spotlight (see buildMenu entryKey) */
  targets?: string[];
  done(world: World): boolean;
}

const has = (w: World, type: string): boolean => w.state.machines.some((m) => m.type === type);

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    text: 'Welcome to <b>Heat Flow</b>. Drag to pan, scroll to zoom (WASD works too). Place a <b>Geothermal Vent</b> (free) on a glowing orange vent tile.',
    shortDone: 'Vent tapped — free 180 °C heat',
    targets: ['m:vent'],
    done: (w) => has(w, 'vent'),
  },
  {
    text: 'Place a <b>Boiler</b> next to the vent — touching machines connect automatically (or run <b>Pipes</b> between them). Heat + water → steam.',
    shortDone: 'Boiler placed',
    targets: ['m:boiler', 'pipe'],
    done: (w) => has(w, 'boiler'),
  },
  {
    text: 'Boilers need feedwater: place a <b>Water Pump</b> next to the boiler (or pipe it in). Your 6 kW auxiliary genset powers it.',
    shortDone: 'Feedwater flowing',
    targets: ['m:pump'],
    done: (w) => has(w, 'pump'),
  },
  {
    text: 'Place a <b>Piston Engine</b> beside the boiler to turn steam into power.',
    shortDone: 'Engine installed',
    targets: ['m:piston'],
    done: (w) => has(w, 'piston'),
  },
  {
    text: 'The 2nd law bites: engines must reject waste heat. Place a <b>Radiator</b> next to the engine — click machines to see their live temperatures.',
    shortDone: 'Power flowing! Watch net efficiency in the top bar',
    targets: ['m:radiator'],
    done: (w) => w.state.machines.some((m) => m.type === 'piston' && m.work > 0.5),
  },
  {
    text: 'Industry time: place a <b>Miner</b> on an ore deposit (rocky tiles), a <b>Smelter</b> (pipe it heat from the vent!), and a <b>Fabricator</b>. Connect them with <b>Belts</b> — drag to lay them, direction follows your drag.',
    shortDone: 'Production chain started',
    targets: ['m:miner', 'm:smelter', 'm:fabricator', 'belt'],
    done: (w) => has(w, 'miner') && has(w, 'smelter') && has(w, 'fabricator'),
  },
  {
    text: 'Place a <b>Research Lab</b>, press <b>T</b> to open Research, select a node, then belt the required parts into the Lab.',
    shortDone: 'Researching!',
    targets: ['m:lab'],
    done: (w) => w.state.research.active !== null || w.state.research.completed.length > 0,
  },
  {
    text: 'The Grand Cycle awaits: sustain <b>55% net efficiency</b> with every machine class active, feeding a Grand Cycle Controller. Keep hot and cold loops separate, insulate pipes, superheat steam, chill your sinks.',
    shortDone: 'You know the way',
    done: (w) => w.state.research.completed.length >= 2,
  },
];

/** build-menu keys the current tutorial step wants spotlit */
export function tutorialTargets(world: World): string[] {
  const step = TUTORIAL_STEPS[world.state.tutorialStep];
  return step?.targets ?? [];
}
