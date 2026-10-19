/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
if (import.meta.env.DEV && import.meta.env.VITE_STUDIO_DEBUG === 'true') {
  void import('./tracing').then(({ registerChain }) => {
    registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
  })
}

export const config = createConfig({
  chains: [arcTestnet, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
