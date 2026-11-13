import { h } from './dom.js';

const ol = (...items) => h('ol', {}, items.map((t) => h('li', {}, t)));

export async function render(el) {
  el.append(
    h('h1', {}, 'Help'),
    h('h2', {}, 'Add to Home Screen'),
    ol('Open this page in Safari on your iPhone.',
      'Tap the Share button.',
      'Choose Add to Home Screen, then tap Add.',
      'Open Capture from the new icon. It works offline after the first load.'),
    h('h2', {}, 'Dictation'),
    h('p', {}, 'Tap the microphone on the iPhone keyboard, speak, then press go. On Windows, press Win+H.'),
    h('h2', {}, 'Privacy rule'),
    h('p', {}, 'Use nicknames only. Never type real program names, customer names or charge numbers on this phone, in tasks or in notes.'),
    h('h2', {}, 'Reminders (iOS Shortcuts)'),
    h('p', { class: 'muted' }, 'The phone cannot push reminders by itself, so use Shortcuts personal automations. For each one: Shortcuts, Automation, New Automation, Time of Day, then Add Action, Open URL, and enter the address of this app. Turn on Run Immediately so it does not ask first.'),
    h('h3', {}, 'Daily (weekdays 16:30)'),
    ol('Time of Day 16:30, Repeat Weekly, select Mon, Tue, Wed, Thu, Fri.',
      'Action: Open URL, this app\'s address.',
      'Set Run Immediately.'),
    h('h3', {}, 'Weekly timecard reminder'),
    ol('Create automations for Thursday 19:00, and for Friday, Saturday and Sunday at 10:00 and 18:00.',
      'Each one: Open URL, this app\'s address, with Run Immediately on.'),
    h('p', {}, 'The phone cannot know when you submitted the week, because data only flows from phone to work. These reminders fire regardless. Tap "Week submitted ✓" on the Today banner to silence the in-app banner until Monday.'),
    h('p', {}, h('a', { href: '#/settings' }, 'Back to Settings')),
  );
}
