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
  },
};

export const PROFILE_OPTIONS = Object.entries(PROFILES).map(([value, p]) => ({ value, label: p.label }));

export function getTerms(profileType) {
  return PROFILES[profileType] || PROFILES.other;
}

export function useTerms(user) {
  return getTerms(user?.profile_type);
}
