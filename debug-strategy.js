const { Aptos, AptosConfig, Network } = require("@aptos-labs/ts-sdk");

const aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));

async function checkSafeStrategies() {
  const safeAddress = "0x23b329bff0ad2f462c7b212458cc0d1b20019af03766cde48bdc9f9d0a17617d";

  try {
    // Get all strategies (including inactive ones)
    const allStrategies = await aptos.view({
      payload: {
        function: "0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700::strategy_registry::get_safe_strategies",
        typeArguments: [],
        functionArguments: [safeAddress],
      },
    });

    console.log("All strategies:", JSON.stringify(allStrategies, null, 2));

    // Get only active strategies
    const activeStrategies = await aptos.view({
      payload: {
        function: "0x8a7ec0bcf45b0b7156f4f1b39bbfe1e42700d1cbcbc5cd05c83754c98c7ff18c::strategy_registry::get_safe_active_strategies",
        typeArguments: [],
        functionArguments: [safeAddress],
      },
    });

    console.log("Active strategies raw:", JSON.stringify(activeStrategies, null, 2));

    // Decode the bytes to see what strings are stored
    if (Array.isArray(activeStrategies) && activeStrategies[0]) {
      const strategies = activeStrategies[0];
      console.log("\nDecoded strategy strings:");
      strategies.forEach((strategyBytes, index) => {
        try {
          const decoded = new TextDecoder().decode(Uint8Array.from(strategyBytes));
          console.log(`  ${index}: "${decoded}" (${strategyBytes.length} bytes)`);
          console.log(`     Hex: ${strategyBytes.map(b => b.toString(16).padStart(2, '0')).join('')}`);
        } catch (e) {
          console.log(`  ${index}: Failed to decode - ${e.message}`);
        }
      });
    }

  } catch (error) {
    console.error("Error:", error);
  }
}

checkSafeStrategies();