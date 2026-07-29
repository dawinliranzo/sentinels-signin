// Terminology per organization profile — set in Settings → Organization Profile.
// Every label the app uses for "the person being visited" comes from here, so a
// building talks about Tenants, a hospital about Doctors, a business about Employees.

const PROFILES = {
  business: {
    label: 'Business / Office',
    hosts: 'Employees',
    host: 'Employee',
    hostsLower: 'employees',
    hostLower: 'employee',
    addHost: 'Add Employee',
    visiting: 'Employee to visit',
    badgeTitle: 'EMPLOYEE BADGE',
    hostPageTitle: 'Employees',
    hostPageSub: 'People visitors can check in to see',
    kioskFields: [],
    defaultTypes: [
      { name: 'Guest', color: '#0D7377' },
      { name: 'Contractor', color: '#FF6B35' },
      { name: 'Delivery', color: '#2ECC71' },
      { name: 'Interview', color: '#9B59B6' },
    ],
  },
  building: {
    label: 'Building / Property',
    hosts: 'Tenants',
    host: 'Tenant',
    hostsLower: 'tenants',
    hostLower: 'tenant',
    addHost: 'Add Tenant',
    visiting: 'Tenant to visit',
    badgeTitle: 'TENANT BADGE',
    hostPageTitle: 'Tenants',
    hostPageSub: 'Tenants visitors can check in to see',
    kioskFields: [
      { key: 'unit', label: 'Apartment / Unit #', type: 'text', required: false, placeholder: 'e.g. 4B' },
    ],
    defaultTypes: [
      { name: 'Guest', color: '#0D7377' },
      { name: 'Delivery', color: '#2ECC71' },
      { name: 'Contractor', color: '#FF6B35' },
      { name: 'Maintenance', color: '#D97706' },
    ],
  },
  hospital: {
    label: 'Hospital / Clinic',
    hosts: 'Doctors & Staff',
    host: 'Doctor / Staff member',
    hostsLower: 'doctors & staff',
    hostLower: 'doctor / staff member',
    addHost: 'Add Doctor / Staff',
    visiting: 'Doctor / Department',
    badgeTitle: 'STAFF BADGE',
    hostPageTitle: 'Doctors & Staff',
    hostPageSub: 'Doctors and staff visitors can check in to see',
    kioskFields: [
      { key: 'dob', label: 'Date of Birth', type: 'date', required: false },
    ],
    defaultTypes: [
      { name: 'Patient', color: '#0D7377' },
      { name: 'Family Member', color: '#9B59B6' },
      { name: 'Vendor', color: '#FF6B35' },
      { name: 'Contractor', color: '#2ECC71' },
    ],
  },
  school: {
    label: 'School / Campus',
    hosts: 'Teachers & Staff',
    host: 'Teacher / Staff member',
    hostsLower: 'teachers & staff',
    hostLower: 'teacher / staff member',
    addHost: 'Add Teacher / Staff',
    visiting: 'Teacher / Staff to visit',
    badgeTitle: 'STAFF BADGE',
    hostPageTitle: 'Teachers & Staff',
    hostPageSub: 'Teachers and staff visitors can check in to see',
    kioskFields: [
      { key: 'student', label: 'Student name or ID', type: 'text', required: false, placeholder: 'Who are you here for?' },
    ],
    defaultTypes: [
      { name: 'Parent', color: '#0D7377' },
      { name: 'Student', color: '#2ECC71' },
      { name: 'Vendor', color: '#FF6B35' },
      { name: 'Staff Visitor', color: '#9B59B6' },
    ],
  },
  other: {
    label: 'Other / General',
    hosts: 'Hosts',
    host: 'Host',
    hostsLower: 'hosts',
    hostLower: 'host',
    addHost: 'Add Host',
    visiting: 'Who are you visiting?',
    badgeTitle: 'HOST BADGE',
    hostPageTitle: 'Hosts',
    hostPageSub: 'People visitors can check in to see',
    kioskFields: [],
    defaultTypes: [
      { name: 'Guest', color: '#0D7377' },
      { name: 'Delivery', color: '#2ECC71' },
      { name: 'Vendor', color: '#FF6B35' },
      { name: 'Other', color: '#9B59B6' },
    ],
  },
};

export const PROFILE_OPTIONS = Object.entries(PROFILES).map(([value, p]) => ({ value, label: p.label }));

export function getTerms(profileType) {
  return PROFILES[profileType] || PROFILES.other;
}

export function useTerms(user) {
  return getTerms(user?.profile_type);
}
