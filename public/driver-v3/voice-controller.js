window.CoachVoiceController = class CoachVoiceController {
  constructor() {
    this.enabled = false;
    this.spoken = new Set();
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  reset() {
    this.spoken.clear();
  }

  maybeSpeak(instruction, distance, index) {
    if (!this.enabled || !instruction) return;

    /*
     * Two useful prompts are clearer than 800m/300m/100m/now repetitions.
     */
    let bucket = '';

    if (distance <= 45) {
      bucket = 'now';
    } else if (distance <= 350) {
      bucket = 'prepare';
    }

    if (!bucket) return;

    const key = `${index}:${bucket}`;
    if (this.spoken.has(key)) return;

    this.spoken.add(key);

    const instructionText =
      String(
        instruction.instruction ||
        'continue on route'
      ).trim();

    if (bucket === 'now') {
      this.speak(
        instructionText,
        {
          interrupt: true
        }
      );
      return;
    }

    const rounded =
      distance >= 250
        ? 300
        : distance >= 150
          ? 200
          : 100;

    this.speak(
      `In ${rounded} metres, ${instructionText}`,
      {
        interrupt: false
      }
    );
  }

  speak(text, { interrupt = false } = {}) {
    if (!('speechSynthesis' in window)) return;

    /*
     * Do not cancel a sentence just to repeat the same instruction. Only a
     * close manoeuvre ("now") is allowed to interrupt a still-playing prompt.
     */
    if (
      speechSynthesis.speaking &&
      !interrupt
    ) {
      return;
    }

    if (interrupt) {
      speechSynthesis.cancel();
    }

    const utterance =
      new SpeechSynthesisUtterance(
        String(text || '').trim()
      );

    utterance.lang = 'en-GB';
    utterance.rate = 0.92;
    utterance.pitch = 1.0;

    speechSynthesis.speak(utterance);
  }
};

/* COACH_SAFE_STAGE191D_VOICE */
