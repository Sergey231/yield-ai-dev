import { FungibleAssetBalance } from '@/lib/types/aptos';
import { getClientBaseUrl } from '@/lib/utils/config';

export class AptosApiService {
  async getBalances(address: string) {
    try {
      if (typeof window === 'undefined') {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (process.env.APTOS_API_KEY) {
          headers['Authorization'] = `Bearer ${process.env.APTOS_API_KEY}`;
        }

        const response = await fetch(`https://indexer.mainnet.aptoslabs.com/v1/graphql`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: `
              query GetAccountBalances($address: String!) {
                current_fungible_asset_balances(
                  where: {owner_address: {_eq: $address}, amount: {_gt: "0"}}
                ) {
                  asset_type
                  amount
                  last_transaction_timestamp
                }
              }
            `,
            variables: { address },
          }),
        });
        
        if (!response.ok) {
          console.error('Aptos API error:', response.status, response.statusText);
          return { balances: [] };
        }

        const data = await response.json();
        const balances = data.data?.current_fungible_asset_balances || [];
        return { balances };
      } else {
        const baseUrl = getClientBaseUrl();
        const response = await fetch(`${baseUrl}/api/aptos/walletBalance?address=${address}`);
        
        if (!response.ok) {
          console.error('Failed to fetch balances from server API:', response.status);
          return { balances: [] };
        }

        const data = await response.json();

        if (data.error) {
          console.error('Server API error:', data.error);
          return { balances: [] };
        }

        return data.data || { balances: [] };
      }
    } catch (error) {
      console.error('Failed to fetch Aptos balances:', error);
      return { balances: [] };
    }
  }
} 