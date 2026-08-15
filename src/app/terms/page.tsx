import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Terms of Use | Yield AI",
  description:
    "Terms of Use for Yield AI, a non-custodial DeFi yield dashboard for Aptos and Solana.",
};

const EFFECTIVE_DATE = "July 2, 2026";

export default function TermsPage() {
  return (
    <LegalPageShell title="Terms of Use" effectiveDate={EFFECTIVE_DATE}>
      <p>
        These Terms of Use (&quot;Terms&quot;) govern your access to and use of
        the Yield AI website, progressive web application, mobile wrapper, and
        related services (collectively, the &quot;Service&quot;) operated at{" "}
        <a href="https://yieldai.app">https://yieldai.app</a> (&quot;Yield
        AI,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). By
        accessing or using the Service, you agree to these Terms. If you do not
        agree, do not use the Service.
      </p>

      <h2>1. About the Service</h2>
      <p>
        Yield AI is a non-custodial software interface that helps users discover,
        monitor, and interact with decentralized finance (&quot;DeFi&quot;)
        protocols on Aptos, Solana, and related networks. The Service may
        display portfolio information, yield opportunities, transaction
        builders, swap quotes, bridge flows, and automation tools. Yield AI does
        not take custody of your digital assets, private keys, or seed phrases.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old (or the age of majority in your
        jurisdiction, if higher) and have the legal capacity to enter into these
        Terms. You are responsible for ensuring that your use of the Service is
        lawful in your jurisdiction. The Service is not offered where prohibited
        by applicable law.
      </p>

      <h2>3. Non-Custodial Wallet Use</h2>
      <p>
        To use certain features, you may connect a compatible wallet (for
        example, Aptos wallet adapters, Solana Mobile Wallet Adapter, Phantom,
        Solflare, or a wallet derived from another connected wallet). You alone
        control your wallet and are solely responsible for safeguarding your
        credentials, approving transactions, and verifying transaction details
        before signing. We never request or store your private keys or seed
        phrases.
      </p>
      <p>
        Blockchain transactions are irreversible. You are solely responsible for
        the consequences of transactions you authorize through your wallet.
      </p>

      <h2>4. No Financial, Legal, or Tax Advice</h2>
      <p>
        Information presented in the Service—including APYs, pool data, strategy
        descriptions, automation settings, and AI-assisted content—is provided
        for informational purposes only. Yield AI does not provide investment,
        financial, legal, accounting, or tax advice. You should conduct your own
        research and consult qualified professionals before making financial
        decisions.
      </p>

      <h2>5. DeFi and Technology Risks</h2>
      <p>
        DeFi involves significant risks, including but not limited to smart
        contract bugs, protocol insolvency, liquidation, impermanent loss,
        oracle failures, bridge failures, network congestion, front-running,
        MEV, regulatory changes, and total loss of funds. Third-party protocols,
        aggregators, bridges, RPC providers, and liquidity venues integrated with
        the Service are independent of Yield AI. We do not guarantee the
        security, availability, accuracy, or performance of any third-party
        service.
      </p>

      <h2>6. Third-Party Protocols and Services</h2>
      <p>
        The Service may interact with or link to third-party protocols, APIs,
        blockchains, wallets, swap aggregators, bridge providers, analytics
        tools, and hosting providers. Your use of third-party services is
        governed by their own terms and policies. We are not responsible for
        third-party content, conduct, or failures.
      </p>

      <h2>7. Automation and Agent Features</h2>
      <p>
        Some features may help you configure or execute automated strategies,
        vault actions, or delegated execution flows. You are responsible for
        reviewing permissions, limits, and transaction outcomes. Automation may
        fail, execute partially, or behave unexpectedly due to market conditions,
        network issues, or protocol changes. Enable automation only if you
        understand and accept the associated risks.
      </p>

      <h2>8. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service for unlawful, fraudulent, or abusive purposes;</li>
        <li>
          attempt to interfere with, disrupt, or gain unauthorized access to the
          Service or related systems;
        </li>
        <li>
          use the Service to exploit vulnerabilities, launder funds, evade
          sanctions, or violate applicable law;
        </li>
        <li>
          scrape, reverse engineer, or misuse the Service except as permitted by
          law;
        </li>
        <li>
          misrepresent your affiliation with Yield AI or any third-party protocol.
        </li>
      </ul>

      <h2>9. Intellectual Property</h2>
      <p>
        The Service, including its software, design, branding, and content
        (excluding third-party and user-provided content), is owned by Yield AI
        or its licensors and is protected by applicable intellectual property
        laws. We grant you a limited, non-exclusive, non-transferable, revocable
        license to use the Service for personal or internal business purposes in
        accordance with these Terms.
      </p>

      <h2>10. Privacy</h2>
      <p>
        Our collection and use of information is described in our{" "}
        <a href="/privacy">Privacy Policy</a>, which is incorporated into these
        Terms by reference.
      </p>

      <h2>11. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS
        AVAILABLE&quot; BASIS WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS,
        IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS
        FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT
        THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR ACCURATE.
      </p>

      <h2>12. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, YIELD AI AND ITS AFFILIATES,
        OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AND LICENSORS WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY,
        OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR DIGITAL
        ASSETS, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE, EVEN IF
        ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
      </p>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY FOR ANY
        CLAIM ARISING OUT OF OR RELATING TO THE SERVICE WILL NOT EXCEED ONE
        HUNDRED U.S. DOLLARS (US$100) OR THE AMOUNT YOU PAID US FOR THE SERVICE
        IN THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM,
        WHICHEVER IS GREATER.
      </p>

      <h2>13. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Yield AI and its
        affiliates from and against any claims, damages, losses, liabilities,
        costs, and expenses (including reasonable attorneys&apos; fees) arising
        out of or related to your use of the Service, your wallet activity, your
        violation of these Terms, or your violation of applicable law.
      </p>

      <h2>14. Suspension and Termination</h2>
      <p>
        We may suspend or discontinue the Service, or restrict access, at any
        time with or without notice. You may stop using the Service at any time.
        Provisions that by their nature should survive termination will survive,
        including disclaimers, limitations of liability, and indemnification.
      </p>

      <h2>15. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. The updated version will be
        posted at this URL with a revised effective date. Your continued use of
        the Service after changes become effective constitutes acceptance of the
        updated Terms.
      </p>

      <h2>16. Governing Law and Disputes</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, United
        States, without regard to conflict-of-law principles, except where
        mandatory consumer protection laws in your jurisdiction apply. Any dispute
        arising out of or relating to these Terms or the Service will be brought
        exclusively in the state or federal courts located in Delaware, and you
        consent to personal jurisdiction in those courts.
      </p>

      <h2>17. Contact</h2>
      <p>
        Questions about these Terms may be sent to{" "}
        <a href="mailto:legal@yieldai.app">legal@yieldai.app</a>.
      </p>
    </LegalPageShell>
  );
}
