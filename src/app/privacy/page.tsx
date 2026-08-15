import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Privacy Policy | Yield AI",
  description:
    "Privacy Policy for Yield AI explaining how we collect, use, and protect information.",
};

const EFFECTIVE_DATE = "July 2, 2026";

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Policy" effectiveDate={EFFECTIVE_DATE}>
      <p>
        This Privacy Policy describes how Yield AI (&quot;Yield AI,&quot;
        &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) processes
        information when you use our website, progressive web application,
        mobile wrapper, and related services (collectively, the
        &quot;Service&quot;) available at{" "}
        <a href="https://yieldai.app">https://yieldai.app</a>.
      </p>
      <p>
        Yield AI is a non-custodial DeFi interface. We do not operate a
        traditional user account system and we do not custody your digital
        assets or private keys.
      </p>

      <h2>1. Scope</h2>
      <p>
        This Privacy Policy applies to the Service operated by Yield AI. It does
        not apply to third-party websites, wallets, blockchains, DeFi protocols,
        aggregators, bridge providers, or other services you may access through
        the Service. Those third parties have their own privacy practices.
      </p>

      <h2>2. Information We Collect</h2>

      <h3>2.1 Information you provide</h3>
      <p>
        The Service is primarily wallet-based and does not require you to create
        a username/password account. We may receive information you voluntarily
        provide when you contact us (for example, your email address and message
        content).
      </p>

      <h3>2.2 Wallet and on-chain information</h3>
      <p>
        When you connect a wallet or view blockchain data through the Service, we
        may process public blockchain information associated with wallet
        addresses you provide or connect, such as:
      </p>
      <ul>
        <li>public wallet addresses on Aptos, Solana, and related networks;</li>
        <li>token balances, positions, rewards, and transaction history;</li>
        <li>transaction hashes and on-chain metadata needed to display portfolio data or build transactions.</li>
      </ul>
      <p>
        Blockchain data is generally public by design. We do not collect or store
        your private keys, seed phrases, or wallet passwords.
      </p>

      <h3>2.3 Device and usage information</h3>
      <p>
        We and our service providers may automatically collect technical
        information when you use the Service, such as:
      </p>
      <ul>
        <li>browser type, device type, operating system, and app version;</li>
        <li>IP address and approximate location derived from IP;</li>
        <li>pages viewed, features used, timestamps, and referral URLs;</li>
        <li>error logs and performance diagnostics.</li>
      </ul>

      <h3>2.4 Local storage on your device</h3>
      <p>
        The Service may store preferences in your browser or app container using
        technologies such as localStorage or cookies, including:
      </p>
      <ul>
        <li>connected wallet adapter selections;</li>
        <li>UI preferences (for example, theme or privacy display settings);</li>
        <li>dismissed banners or feature acknowledgments;</li>
        <li>locally cached portfolio or price data for performance.</li>
      </ul>
      <p>
        You can clear this data through your browser or device settings. Clearing
        local data may reset preferences but does not delete public blockchain
        records.
      </p>

      <h2>3. How We Use Information</h2>
      <p>We use information to:</p>
      <ul>
        <li>provide, operate, maintain, and improve the Service;</li>
        <li>display portfolio data, quotes, and transaction builders;</li>
        <li>route requests to blockchain RPCs and third-party DeFi APIs;</li>
        <li>monitor performance, debug errors, and protect against abuse;</li>
        <li>comply with legal obligations and enforce our terms;</li>
        <li>respond to support requests and communicate with you.</li>
      </ul>
      <p>
        We do not sell your personal information. We do not use your information
        to make automated decisions that produce legal or similarly significant
        effects.
      </p>

      <h2>4. How We Share Information</h2>
      <p>We may share information with:</p>
      <ul>
        <li>
          <strong>Infrastructure providers</strong> (for example, hosting,
          analytics, logging, and content delivery) that process data on our
          behalf;
        </li>
        <li>
          <strong>Blockchain and DeFi service providers</strong> when needed to
          fetch balances, prices, quotes, or submit transactions you request
          (for example, RPC providers, indexers, swap aggregators, bridge
          providers, and protocol APIs);
        </li>
        <li>
          <strong>Professional advisors and authorities</strong> when required by
          law, legal process, or to protect rights, safety, and security.
        </li>
      </ul>
      <p>
        When you initiate a blockchain transaction, relevant data is broadcast to
        public networks and may be visible to anyone.
      </p>

      <h2>5. Third-Party Services</h2>
      <p>
        The Service integrates with third-party services that may collect
        information under their own policies, including but not limited to:
      </p>
      <ul>
        <li>Vercel (hosting and analytics);</li>
        <li>Aptos and Solana RPC/indexer providers;</li>
        <li>wallet adapters and Mobile Wallet Adapter providers;</li>
        <li>token price and swap quote providers (for example, Panora, Jupiter);</li>
        <li>DeFi protocols you choose to interact with;</li>
        <li>Circle CCTP and other bridge infrastructure when you use bridge features.</li>
      </ul>
      <p>
        We require service providers that process data on our behalf to use
        information only as needed to provide services to us, subject to
        contractual and legal obligations.
      </p>

      <h2>6. Data Retention</h2>
      <p>
        We retain information only as long as reasonably necessary for the
        purposes described in this Privacy Policy, unless a longer retention
        period is required or permitted by law. Server logs and analytics data are
        typically retained for a limited period. Public blockchain data persists
        on-chain independently of Yield AI.
      </p>

      <h2>7. Security</h2>
      <p>
        We use administrative, technical, and organizational measures designed
        to protect information we process. However, no method of transmission or
        storage is completely secure. You are responsible for securing your
        wallet, device, and network environment.
      </p>

      <h2>8. Your Choices and Rights</h2>
      <p>Depending on your location, you may have rights to:</p>
      <ul>
        <li>access, correct, or delete certain personal information;</li>
        <li>object to or restrict certain processing;</li>
        <li>withdraw consent where processing is based on consent;</li>
        <li>receive a copy of certain information in a portable format;</li>
        <li>opt out of certain analytics where applicable.</li>
      </ul>
      <p>
        Because the Service is wallet-based and largely non-custodial, we may
        not be able to identify you from a wallet address alone. To exercise
        privacy rights, contact us using the details below and provide enough
        information for us to verify your request.
      </p>
      <p>
        You can stop using the Service at any time and disconnect your wallet.
        You can clear local browser/app storage through your device settings.
      </p>

      <h2>9. Children</h2>
      <p>
        The Service is not directed to individuals under 18 years of age (or the
        age required in your jurisdiction). We do not knowingly collect personal
        information from children without appropriate parental consent.
      </p>

      <h2>10. International Users</h2>
      <p>
        We may process and store information in countries other than your own,
        including the United States. Those countries may have data protection laws
        that differ from the laws of your jurisdiction.
      </p>

      <h2>11. California Privacy Notice</h2>
      <p>
        If you are a California resident, you may have additional rights under
        the California Consumer Privacy Act (CCPA), as amended, including rights
        to know, delete, and correct personal information, and to opt out of
        certain sharing that may be considered a &quot;sale&quot; or
        &quot;sharing&quot; under California law. We do not sell personal
        information for money. To submit a request, email{" "}
        <a href="mailto:privacy@yieldai.app">privacy@yieldai.app</a>.
      </p>

      <h2>12. European Economic Area, UK, and Switzerland</h2>
      <p>
        Where applicable law requires, our legal bases for processing include
        performance of a contract, legitimate interests (such as securing and
        improving the Service), compliance with legal obligations, and consent
        where required. You may have the right to lodge a complaint with your
        local supervisory authority.
      </p>

      <h2>13. Changes to This Privacy Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. The updated version
        will be posted at this URL with a revised effective date. Material
        changes may also be communicated through the Service where appropriate.
      </p>

      <h2>14. Contact Us</h2>
      <p>
        For privacy questions or requests, contact us at{" "}
        <a href="mailto:privacy@yieldai.app">privacy@yieldai.app</a>.
      </p>
      <p>
        For general legal inquiries, contact{" "}
        <a href="mailto:legal@yieldai.app">legal@yieldai.app</a>.
      </p>
    </LegalPageShell>
  );
}
