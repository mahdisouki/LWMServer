const { getPeopleAuth } = require('./gmailAuthHelper');

const PERSON_FIELDS = 'names,emailAddresses,photos';

function normalizePerson(person) {
  const emails = (person.emailAddresses || [])
    .map((e) => e.value)
    .filter(Boolean);
  if (emails.length === 0) return [];

  const name =
    person.names?.[0]?.displayName ||
    person.names?.[0]?.unstructuredName ||
    null;

  const photoUrl = person.photos?.[0]?.url || null;

  return emails.map((email) => ({
    name,
    email,
    photoUrl,
  }));
}

function dedupeContacts(contacts) {
  const seen = new Map();
  for (const contact of contacts) {
    const key = contact.email.toLowerCase();
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, contact);
      continue;
    }

    if (!existing.name && contact.name) {
      seen.set(key, { ...existing, ...contact });
    }
  }
  return Array.from(seen.values());
}

async function listSavedContacts(adminId) {
  const people = await getPeopleAuth(adminId);
  const contacts = [];
  let pageToken;

  do {
    const response = await people.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      personFields: PERSON_FIELDS,
      pageToken,
    });

    const connections = response.data.connections || [];
    for (const person of connections) {
      contacts.push(...normalizePerson(person));
    }
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return contacts;
}

async function listOtherContacts(adminId) {
  const people = await getPeopleAuth(adminId);
  const contacts = [];
  let pageToken;

  do {
    const response = await people.otherContacts.list({
      pageSize: 1000,
      readMask: PERSON_FIELDS,
      pageToken,
    });

    const otherContacts = response.data.otherContacts || [];
    for (const person of otherContacts) {
      contacts.push(...normalizePerson(person));
    }
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return contacts;
}

async function searchSavedContacts(adminId, query) {
  const people = await getPeopleAuth(adminId);
  const response = await people.people.searchContacts({
    query,
    pageSize: 30,
    readMask: PERSON_FIELDS,
  });

  const results = response.data.results || [];
  const contacts = [];
  for (const item of results) {
    if (item.person) {
      contacts.push(...normalizePerson(item.person));
    }
  }
  return contacts;
}

async function searchOtherContacts(adminId, query) {
  const people = await getPeopleAuth(adminId);
  const response = await people.otherContacts.search({
    query,
    pageSize: 30,
    readMask: PERSON_FIELDS,
  });

  const results = response.data.results || [];
  const contacts = [];
  for (const item of results) {
    if (item.person) {
      contacts.push(...normalizePerson(item.person));
    }
  }
  return contacts;
}

async function listAllContacts(adminId) {
  const [saved, others] = await Promise.all([
    listSavedContacts(adminId).catch((error) => {
      console.warn('Failed to load saved contacts:', error.message);
      return [];
    }),
    listOtherContacts(adminId).catch((error) => {
      console.warn('Failed to load other contacts:', error.message);
      return [];
    }),
  ]);

  return dedupeContacts([...saved, ...others]);
}

async function searchAllContacts(adminId, query) {
  if (!query || !query.trim()) {
    const all = await listAllContacts(adminId);
    return all.slice(0, 50);
  }

  const [saved, others] = await Promise.all([
    searchSavedContacts(adminId, query).catch((error) => {
      console.warn('Failed to search saved contacts:', error.message);
      return [];
    }),
    searchOtherContacts(adminId, query).catch((error) => {
      console.warn('Failed to search other contacts:', error.message);
      return [];
    }),
  ]);

  const merged = dedupeContacts([...saved, ...others]);
  const lowered = query.toLowerCase();

  return merged
    .filter(
      (contact) =>
        contact.email.toLowerCase().includes(lowered) ||
        (contact.name && contact.name.toLowerCase().includes(lowered))
    )
    .slice(0, 50);
}

module.exports = {
  listAllContacts,
  searchAllContacts,
};
