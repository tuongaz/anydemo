import { canonicalAwsName } from './normalize-aws.ts';
import { canonicalAzureName } from './normalize-azure.ts';
import { canonicalGcpName } from './normalize-gcp.ts';
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

const GCP: VendorDescriptor = {
  vendor: 'gcp',
  label: 'Google Cloud',
  defaultPackUrl: 'https://cloud.google.com/static/architecture/icons/icons.zip',
  licenseSummary:
    'Google Cloud architecture icons are provided for use in architecture diagrams. See license URL for full terms.',
  licenseUrl: 'https://cloud.google.com/architecture/icons',
  requiresAcceptance: false,
  canonicalName: canonicalGcpName,
};

const AZURE: VendorDescriptor = {
  vendor: 'azure',
  label: 'Microsoft Azure',
  defaultPackUrl: 'https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V20.zip',
  licenseSummary:
    'Microsoft requires explicit acceptance of the Azure architecture icon terms before use. Icons may not be modified and must not be used to imply Microsoft endorsement. See license URL for full terms.',
  licenseUrl: 'https://learn.microsoft.com/en-us/azure/architecture/icons/',
  requiresAcceptance: true,
  canonicalName: canonicalAzureName,
};

export const VENDOR_DESCRIPTORS: Record<IconVendor, VendorDescriptor> = {
  aws: AWS,
  gcp: GCP,
  azure: AZURE,
};

export function vendorDescriptor(vendor: IconVendor): VendorDescriptor {
  return VENDOR_DESCRIPTORS[vendor];
}
