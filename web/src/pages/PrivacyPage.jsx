import { Link } from 'react-router'
import { useAuth } from '../context/AuthContext'

// Public: linked from the sign-in and register pages and from Profile.
// Keep it true: when Splitty starts storing something new, sending data to a
// new service, or keeping something longer, update this page and its date.
const UPDATED = '6 November 2026'

export default function PrivacyPage() {
  const { token } = useAuth()

  return (
    <div className="privacy-page">
      <article className="privacy">
        <Link to={token ? '/profile' : '/login'} className="privacy-back">‹ {token ? 'Back to Splitty' : 'Sign in'}</Link>
        <h1>Privacy</h1>
        <p className="privacy-updated">Last updated {UPDATED}</p>

        <p>
          Splitty is a small app for sharing expenses and planning trips with other people. This page explains
          what it stores about you, why, who else sees any of it, how long it is kept, and what you can do about it.
        </p>

        <h2>Who is responsible</h2>
        <p>
          Splitty is run by Jonas Fiers, a private person, not a company. He is responsible for your data
          (the “controller” under the GDPR). For anything about your data, email{' '}
          <a href="mailto:hello@jonasfiers.eu">hello@jonasfiers.eu</a>.
        </p>

        <h2>What Splitty stores</h2>
        <ul>
          <li><strong>Your account:</strong> name, email address, your password (only as a one-way hash, never the password itself), the colour and emoji of your avatar, and whether you confirmed your email address.</li>
          <li><strong>Passkeys</strong>, if you add any: the public key your device creates (your device keeps the private part), a label for the device such as “iPhone · Safari”, and when it was added and last used.</li>
          <li><strong>What you enter:</strong> groups and who is in them, expenses, who paid and who owes what, settlements, and trips: places, times, booking references, notes, links, and files you upload such as tickets.</li>
          <li><strong>Who did what:</strong> who added, changed or deleted an expense, trip, trip item or file in a group, and when. Other members see this on the Activity page. When something is deleted, its content is erased; only its name (and amount, for an expense), who deleted it and when are kept, until the group itself is deleted.</li>
          <li><strong>Notifications</strong>, if you switch them on: the address your browser’s push service gives Splitty to reach your device.</li>
          <li><strong>Server logs:</strong> the web server records each request (your IP address, the address requested, the time, and your browser’s description of itself), and the app logs errors, which can include your internal account number. These are used to keep the service running and to spot attacks.</li>
        </ul>
        <p>
          Splitty has no advertising, no analytics and no tracking cookies. Your browser keeps two things for it:
          your sign-in (so you stay signed in) and your light/dark choice.
        </p>

        <h2>Why</h2>
        <p>
          Your account and what you enter are needed to provide the service you signed up for (GDPR article 6(1)(b)).
          Server logs and security measures are kept because Splitty has a legitimate interest in keeping the
          service secure and working (article 6(1)(f)).
        </p>

        <h2>Who else sees your data</h2>
        <ul>
          <li><strong>The people in your groups</strong> see your name and avatar, and the expenses, balances and trips of the groups you share with them. They do not see your email address.</li>
          <li><strong>Migadu</strong>, Splitty’s email provider, handles the emails Splitty sends you (confirming your address, resetting your password, confirming a deletion).</li>
          <li><strong>Your browser’s push service</strong>, if you switch on notifications: Google for Chrome and Android, Apple for Safari, Mozilla for Firefox. It carries the notification to your device.</li>
          <li><strong>OpenStreetMap</strong> provides the map tiles. Your browser loads them directly from openstreetmap.org, so OpenStreetMap sees your IP address when you look at a map.</li>
          <li><strong>Place and route search:</strong> when you search for a place, Splitty’s server asks OpenStreetMap’s Nominatim service; when you look for a public-transport route, it asks Transitous. They receive what you searched for (a place name, or the stops and times), not your name, email or IP address.</li>
          <li><strong>Directions:</strong> if you tap “Navigate here”, your device opens Apple Maps, your map app, or OpenStreetMap with that place.</li>
        </ul>
        <p>Splitty does not sell or share your data with anyone else.</p>

        <h2>Where it is kept</h2>
        <p>
          On Jonas’s own server in Belgium, with backups on a disk in the same place. Only the services listed
          above receive anything, and only what is described there. Jonas also runs a test copy of Splitty, which
          only he can reach, on a copy of the same data; deleting your account deletes it there too, within an hour.
        </p>

        <h2>How long</h2>
        <ul>
          <li><strong>Your account and what you enter:</strong> until you delete your account.</li>
          <li><strong>Server logs</strong> (web server and app): 30 days.</li>
          <li><strong>Backups:</strong> overwritten after 7 to 14 days. After you delete your account, it can still be in a backup for up to 14 days. If a backup is ever restored, your account is deleted again automatically before Splitty is used.</li>
          <li><strong>Links in emails</strong> (password reset, email confirmation): until they expire, after 24 hours at most.</li>
          <li><strong>After you delete your account:</strong> Splitty keeps a note of your internal account number (a random code, without your name or email) and the time of deletion, for as long as backups could hold your account, so that it stays deleted. Jonas gets an email with the same note.</li>
        </ul>

        <h2>Your rights</h2>
        <ul>
          <li><strong>See and take your data:</strong> Profile › Download all my data gives you a ZIP with your account, your groups, every expense, your trips and the files you uploaded, as JSON and CSV files that other apps can read. For anything else, email <a href="mailto:hello@jonasfiers.eu">hello@jonasfiers.eu</a>.</li>
          <li><strong>Correct it:</strong> change your name, email and avatar in Profile, and edit what you entered in the app.</li>
          <li><strong>Delete it:</strong> Profile › Delete account. Your name, email, password, passkeys, avatar and notification settings are deleted at once, and you are signed out on every device. What you added to groups you share with others (expenses, trip plans, notes and uploaded files) stays in those groups for the other members, shown as “Deleted user”, so their balances and plans stay correct. Groups where nobody else is left are deleted completely, with their trips and files.</li>
          <li><strong>Object or restrict:</strong> email <a href="mailto:hello@jonasfiers.eu">hello@jonasfiers.eu</a>.</li>
          <li><strong>Complain:</strong> you can complain to the Belgian Data Protection Authority (<a href="https://www.dataprotectionauthority.be" target="_blank" rel="noopener noreferrer">dataprotectionauthority.be</a>) or the authority where you live.</li>
        </ul>

        <h2>Changes</h2>
        <p>If this page changes in a way that matters, Splitty will tell you in the app. The date at the top shows the last change.</p>
      </article>
    </div>
  )
}
