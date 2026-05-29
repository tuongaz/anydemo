import { canonicalAwsName } from './normalize-aws.ts';
import type { IconVendor } from './paths.ts';

export interface VendorDescriptor {
  vendor: IconVendor;
  label: string;
  defaultPackUrl: string;
  /** Short summary; UI shows it inline. Authoritative terms live at `licenseUrl`. */
  licenseSummary: string;
  licenseUrl: string;
  /** Whether the user must affirmatively accept terms before install. */
  requiresAcceptance: boolean;
  /** Filename → canonical kebab-name; null = skip entry. */
  canonicalName: (filename: string) => string | null;
}

const AWS: VendorDescriptor = {
  vendor: 'aws',
  label: 'AWS',
  defaultPackUrl:
    'https://d1.awsstatic.com/webteam/architecture-icons/q1-2025/Asset-Package_02072025.7e4c5e.zip',
  licenseSummary:
    'Free to use in architecture diagrams. Attribution required for any public publication. See license URL for full terms.',
  licenseUrl: 'https://aws.amazon.com/architecture/icons/',
  requiresAcceptance: false,
  canonicalName: canonicalAwsName,
};

export const VENDOR_DESCRIPTORS: Record<IconVendor, VendorDescriptor> = {
  aws: AWS,
  gcp: AWS, // placeholder — overwritten in Stage 5.1
  azure: AWS, // placeholder — overwritten in Stage 5.2
};

export function vendorDescriptor(vendor: IconVendor): VendorDescriptor {
  return VENDOR_DESCRIPTORS[vendor];
}
