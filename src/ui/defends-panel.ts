/**
 * EXHIBIT 7 -- what defends.
 *
 * Everything on this panel is what the paper's section 8, "Countermeasures and
 * their Limitations", actually says, read before it was written. The section's
 * own framing matters as much as its list: memory imaging is hard to defend
 * against BECAUSE a key in active use has to be somewhere, and the authors say
 * plainly that they know of no simple remedy that eliminates the risk.
 *
 * Nothing here is advice about a current operating system or a shipping
 * product. It is a 2008 paper, reported as a 2008 paper.
 */

import { el, fill } from './dom';

interface Measure {
  readonly name: string;
  readonly verdict: 'helps' | 'limited' | 'no';
  readonly text: string;
}

const MEASURES: readonly Measure[] = [
  {
    name: 'Scrub memory, and do not page keys to disk',
    verdict: 'limited',
    text:
      'Overwrite keys the moment they are no longer needed, and have libraries and the operating ' +
      'system clear memory proactively. The paper cites work showing this need not be expensive. ' +
      'Its limit is the one that matters here: it cannot protect a key that is still IN USE, which ' +
      'is exactly the case for a mounted encrypted disk or a live web server.',
  },
  {
    name: 'Clear RAM at boot',
    verdict: 'limited',
    text:
      'Some PCs can be set to wipe memory in a destructive power-on self-test before loading an ' +
      'operating system. If the attacker cannot bypass that test, they cannot image memory with ' +
      'software running locally — but they can still move the chips to a machine with a more ' +
      'permissive BIOS.',
  },
  {
    name: 'Stop the machine booting from network or removable media',
    verdict: 'limited',
    text:
      'Many of the paper’s attacks start by booting the target from the network or a USB device, ' +
      'and requiring a password for that closes the easy path. The paper notes the attacker can ' +
      'still swap the drive, or in many cases reset the NVRAM to re-enable those boot sources.',
  },
  {
    name: 'Locking the screen',
    verdict: 'no',
    text:
      'Does not protect memory at all. The machine is still running and the key is still there.',
  },
  {
    name: 'Sleeping the laptop',
    verdict: 'no',
    text:
      'Also ineffective, even if it screen-locks on waking: an adversary can wake it, cut the ' +
      'power, and take the memory. Hibernating is no better unless resuming requires a secret held ' +
      'outside the machine.',
  },
  {
    name: 'Powering off completely',
    verdict: 'helps',
    text:
      'With most of the disk-encryption systems the paper studied, a user who fully powers the ' +
      'machine down when it is not in use is protected — and should guard it for a minute or so ' +
      'afterwards, because the contents persist briefly. The paper calls this effective and ' +
      'inconvenient, and names one exception it tested: BitLocker in its "basic" TPM mode stays ' +
      'vulnerable, because the disk mounts automatically when the machine powers on.',
  },
  {
    name: 'Suspending with the memory encrypted under a password',
    verdict: 'helps',
    text:
      'Suspending can be made safe by requiring a password or other external secret to wake, and ' +
      'encrypting memory under a key derived from it. The password has to be strong or ' +
      'strengthened, because an attacker holding the memory image can attack it offline. ' +
      'Encrypting only the pages holding key material is the cheaper version.',
  },
  {
    name: 'Not precomputing the key schedule',
    verdict: 'helps',
    text:
      'This is the exhibit you have been looking at. The paper states the trade-off directly: ' +
      'precomputation speeds up encryption and makes keys MORE vulnerable, because it stores key ' +
      'information redundantly and that redundancy is what lets an attacker correct errors. Every ' +
      'disk-encryption system they studied precomputed a key schedule and kept it in memory for as ' +
      'long as the disk was mounted. Dropping it costs performance, and the compromise they ' +
      'suggest is caching precomputed values for a bounded time and discarding them if unused.',
  },
  {
    name: 'Storing the key XORed with a hash of a large random buffer',
    verdict: 'helps',
    text:
      'For a key that is not currently in use: fill a large B-bit buffer with random data R and ' +
      'store K XOR H(R). If d bits of the buffer then decay, the attacker has to search which of ' +
      'about B/2 candidate bits flipped, and for large B that is prohibitive even for small d. The ' +
      'paper relates this to exposure-resilient functions, and notes the operating system could go ' +
      'further and deliberately place key material in the memory locations that decay fastest.',
  },
  {
    name: 'Physically protecting the chips',
    verdict: 'limited',
    text:
      'Lock the modules in place, or pot them in epoxy, so they cannot be removed or probed; or ' +
      'have the machine overwrite memory when it detects low temperatures or its case opening — ' +
      'which needs active sensors on their own backup power. The paper associates these with ' +
      'tamper-resistant hardware and notes they add considerable cost, though a small amount of ' +
      'memory soldered to the board is cheap.',
  },
  {
    name: 'Architectural change: memory that forgets, or memory that is encrypted',
    verdict: 'limited',
    text:
      'Designing DRAM that loses state quickly might be difficult. Architectures that routinely ' +
      'encrypt the contents of memory would, the paper says, apparently prevent these attacks — as ' +
      'long as the encryption keys are destroyed on reset or power loss. Neither helps a machine ' +
      'that already exists.',
  },
  {
    name: 'Encrypting in the disk controller',
    verdict: 'limited',
    text:
      'Keeping the key in a write-only register in the controller moves it out of DRAM entirely. ' +
      'To be secure the register has to be erased whenever a new operating system boots, or ' +
      'whenever the controller is moved to another machine even with power maintained. The paper ' +
      'evaluated no specific product of this kind and left it to future work.',
  },
  {
    name: 'A TPM',
    verdict: 'no',
    text:
      'Useful against other attacks, and not this one. Deployed TPMs of the time did not do bulk ' +
      'encryption; they gated whether a key should be released into RAM at all. The paper’s ' +
      'sentence is the one to remember: a TPM can prevent a key from being loaded into memory, but ' +
      'it cannot prevent it from being captured once it is there.',
  },
];

const VERDICT_WORDS: Record<Measure['verdict'], string> = {
  helps: 'Helps',
  limited: 'Helps, with limits',
  no: 'Does not help',
};

const VERDICT_MARKS: Record<Measure['verdict'], string> = {
  helps: 'OK',
  limited: '~~',
  no: 'XX',
};

const VERDICT_CLASS: Record<Measure['verdict'], 'pass' | 'note' | 'fail'> = {
  helps: 'pass',
  limited: 'note',
  no: 'fail',
};

export function renderDefendsPanel(target: HTMLElement): void {
  const items = MEASURES.map((measure) =>
    el('li', { role: 'listitem' }, [
      el('div', { class: `check-line check-${VERDICT_CLASS[measure.verdict]}` }, [
        el('span', { class: 'check-mark', 'aria-hidden': 'true', text: VERDICT_MARKS[measure.verdict] }),
        el('span', {}, [
          el('strong', { text: `${measure.name} — ${VERDICT_WORDS[measure.verdict]}. ` }),
          document.createTextNode(measure.text),
        ]),
      ]),
    ]),
  );

  fill(target, [
    el('h2', { text: 'What defends' }),
    el('div', { class: 'card intro' }, [
      el('p', {
        text:
          'The paper devotes a section to countermeasures and calls it "Countermeasures and their ' +
          'Limitations", which is the honest title. Its opening explains why: memory imaging is ' +
          'hard to defend against because a key that is in active use has to be stored somewhere, ' +
          'and the suggestions that follow are about discarding or obscuring keys before an ' +
          'adversary gets physical access, keeping memory-dumping software off the machine, ' +
          'protecting the chips, and making memory decay faster.',
      }),
      el('p', {
        text:
          'Its abstract is blunter still: though the authors discuss several strategies for ' +
          'partially mitigating these risks, they know of no simple remedy that would eliminate ' +
          'them. Everything below is theirs, not this lab’s.',
      }),
    ]),
    ((): HTMLElement => {
      const list = el('ul', { class: 'legend', role: 'list' }, [
        el('li', { role: 'listitem' }, [
          el('span', { class: 'swatch swatch-kept', 'aria-hidden': 'true', text: 'OK ' }),
          document.createTextNode('the paper recommends it'),
        ]),
        el('li', { role: 'listitem' }, [
          el('span', { class: 'swatch swatch-accent', 'aria-hidden': 'true', text: '~~ ' }),
          document.createTextNode('the paper recommends it and names a limit'),
        ]),
        el('li', { role: 'listitem' }, [
          el('span', { class: 'swatch swatch-lost', 'aria-hidden': 'true', text: 'XX ' }),
          document.createTextNode('the paper says it does not help'),
        ]),
      ]);
      return list;
    })(),
    el('ul', { class: 'measures', role: 'list' }, items),
    el('div', { class: 'card' }, [
      el('h3', { text: 'The one that this lab is about' }),
      el('p', {
        text:
          'Of everything on that list, one item is the subject of these exhibits: avoiding ' +
          'precomputation. The key schedule is kept in memory because recomputing it per block ' +
          'would be slower, and keeping it is what turns a damaged 16-byte secret into a damaged ' +
          '176-byte encoding of that secret with enough redundancy to repair it. That is a ' +
          'performance decision with a security cost, and it is the cost this page measures.',
      }),
    ]),
    el('div', { class: 'notice notice-scope' }, [
      el('p', {}, [
        el('strong', { text: 'Dates matter here. ' }),
        document.createTextNode(
          'This is a 2008 paper describing the systems of 2008: the versions of BitLocker, ' +
            'TrueCrypt, FileVault, dm-crypt and Loop-AES the authors tested then, and the TPMs ' +
            'deployed then. It is not a statement about any current operating system, disk ' +
            'encryption product or machine, and this lab makes no such statement. If you need to ' +
            'know where a system stands today, check that system today.',
        ),
      ]),
    ]),
  ]);
}
