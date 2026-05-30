import { canonicalAwsName } from './normalize-aws.ts';
import { canonicalAzureName } from './normalize-azure.ts';
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
  // AWS re-issues this asset every release and removes prior versions; the
  // q1-2025 path now 403s from CloudFront. Keep this in sync with whatever
  // the Icon-package link at https://aws.amazon.com/architecture/icons/
  // currently points to.
  defaultPackUrl:
    'https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/architecture/approved/architecture-icons/Icon-package_04302026.4705b90f5aa45b019271a2699e9ce9b97b941ee1.zip',
  licenseSummary:
    'Free to use in architecture diagrams. Attribution required for any public publication. See license URL for full terms.',
  licenseUrl: 'https://aws.amazon.com/architecture/icons/',
  requiresAcceptance: false,
  canonicalName: canonicalAwsName,
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
  azure: AZURE,
};

export function vendorDescriptor(vendor: IconVendor): VendorDescriptor {
  return VENDOR_DESCRIPTORS[vendor];
}
