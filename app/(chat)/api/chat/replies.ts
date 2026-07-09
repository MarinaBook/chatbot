// Localized, deterministic replies for the MarinaBook server-to-server chat.
//
// These replies are templated (not LLM-generated) so they stay available even
// when the LLM is down (regex fallback path). Structured data — port names,
// place types, dates, prices, currencies and URLs — is always interpolated
// verbatim and never translated, per the MarinaBook grounding rules.
//
// French and English strings are preserved word-for-word from the original
// fr/en implementation to keep existing behaviour (and tests) stable.

import type { ReplyLanguage } from "./language";

type SearchParamsForReply = {
  arrivalDate?: string;
  boatLength?: number;
  boatWidth?: number;
  departureDate?: string;
  destination?: string;
  draft?: number;
};

type ResultForReply = {
  currency: string;
  placeType: string;
  portName: string;
  price: number;
};

const REQUIRED_FIELDS = [
  "destination",
  "arrivalDate",
  "departureDate",
  "boatLength",
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];
type FieldName = RequiredField | "boatWidth";

// Field labels used both for "missing information" and for the required-field
// error branches ("I still need <label> to run the search.").
const FIELD_LABELS: Record<ReplyLanguage, Record<FieldName, string>> = {
  ar: {
    arrivalDate: "تاريخ الوصول",
    boatLength: "طول القارب",
    boatWidth: "عرض القارب",
    departureDate: "تاريخ المغادرة",
    destination: "الوجهة",
  },
  de: {
    arrivalDate: "das Anreisedatum",
    boatLength: "die Bootslänge",
    boatWidth: "die Bootsbreite",
    departureDate: "das Abreisedatum",
    destination: "das Ziel",
  },
  en: {
    arrivalDate: "the arrival date",
    boatLength: "the boat length",
    boatWidth: "the boat width",
    departureDate: "the departure date",
    destination: "the destination",
  },
  es: {
    arrivalDate: "la fecha de llegada",
    boatLength: "la eslora del barco",
    boatWidth: "la manga del barco",
    departureDate: "la fecha de salida",
    destination: "el destino",
  },
  fr: {
    arrivalDate: "la date d’arrivée",
    boatLength: "la longueur du bateau",
    boatWidth: "la largeur du bateau",
    departureDate: "la date de départ",
    destination: "la destination",
  },
  it: {
    arrivalDate: "la data di arrivo",
    boatLength: "la lunghezza della barca",
    boatWidth: "la larghezza della barca",
    departureDate: "la data di partenza",
    destination: "la destinazione",
  },
  pt: {
    arrivalDate: "a data de chegada",
    boatLength: "o comprimento do barco",
    boatWidth: "a largura do barco",
    departureDate: "a data de partida",
    destination: "o destino",
  },
};

type Messages = {
  general: string;
  listSeparator: string;
  missingMany: (list: string) => string;
  missingOne: (field: string) => string;
  noAvailability: string;
  results: (
    result: ResultForReply,
    arrival: string,
    departure: string
  ) => string;
  unsupported: string;
  errorDraftIgnored: string;
  errorGeneric: string;
  errorNotConfigured: string;
  errorUnavailable: string;
};

const MESSAGES: Record<ReplyLanguage, Messages> = {
  ar: {
    errorDraftIgnored:
      "أحتفظ بغاطس القارب في السياق، لكنني لا أرسله إلى MarinaBook لهذا البحث.",
    errorGeneric:
      "واجهت عملية البحث في MarinaBook خطأً في الخادم. يرجى المحاولة مرة أخرى بعد قليل.",
    errorNotConfigured: "خدمة MarinaBook غير مُهيأة على الخادم.",
    errorUnavailable:
      "خدمة MarinaBook غير متوفرة مؤقتًا. يرجى المحاولة مرة أخرى بعد قليل.",
    general:
      "لقد استلمت رسالتك. واجهة JSON هذه مُحسّنة حاليًا لعمليات البحث عن توفر الأماكن في MarinaBook.",
    listSeparator: "، ",
    missingMany: (list) => `لا يزال ينقصني ${list} لبدء البحث.`,
    missingOne: (field) => `ينقصني ${field} لبدء البحث.`,
    noAvailability:
      "لم أجد أي توفر يطابق هذه المعايير. يمكنك تعديل التواريخ أو الوجهة أو أبعاد القارب.",
    results: (result, arrival, departure) =>
      `وجدت توفرًا في ${result.portName}، مكان ${result.placeType}، من ${arrival} إلى ${departure}، مقابل ${result.price} ${result.currency}. يمكنك إتمام الحجز عبر الزر أدناه.`,
    unsupported:
      "يمكنني فقط مساعدتك في البحث عن مكان لرسو القارب. يرجى تحديد وجهة وتاريخي الوصول والمغادرة وطول قاربك.",
  },
  de: {
    errorDraftIgnored:
      "Ich behalte den Tiefgang im Kontext, sende ihn aber für diese Suche nicht an MarinaBook.",
    errorGeneric:
      "Bei der MarinaBook-Suche ist ein serverseitiger Fehler aufgetreten. Bitte versuchen Sie es in Kürze erneut.",
    errorNotConfigured:
      "Der MarinaBook-Dienst ist auf dem Server nicht konfiguriert.",
    errorUnavailable:
      "Der MarinaBook-Dienst ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in Kürze erneut.",
    general:
      "Ich habe Ihre Nachricht erhalten. Diese JSON-API ist derzeit auf MarinaBook-Verfügbarkeitsanfragen optimiert.",
    listSeparator: ", ",
    missingMany: (list) => `Mir fehlen noch ${list}, um die Suche zu starten.`,
    missingOne: (field) => `Mir fehlt noch ${field}, um die Suche zu starten.`,
    noAvailability:
      "Ich habe keine Verfügbarkeit gefunden, die diesen Kriterien entspricht. Sie können die Daten, das Ziel oder die Bootsmaße anpassen.",
    results: (result, arrival, departure) =>
      `Ich habe Verfügbarkeit bei ${result.portName}, Liegeplatz ${result.placeType}, vom ${arrival} bis ${departure}, für ${result.price} ${result.currency} gefunden. Sie können die Buchung mit der Schaltfläche unten abschließen.`,
    unsupported:
      "Ich kann Ihnen nur bei der Suche nach einem Liegeplatz helfen. Geben Sie ein Ziel, das An- und Abreisedatum sowie die Länge Ihres Bootes an.",
  },
  en: {
    errorDraftIgnored:
      "I keep the draft in context, but I do not send it to MarinaBook for this search.",
    errorGeneric:
      "The MarinaBook search hit a server-side error. Please try again shortly.",
    errorNotConfigured:
      "The MarinaBook service is not configured on the server.",
    errorUnavailable:
      "The MarinaBook service is temporarily unavailable. Please try again shortly.",
    general:
      "I received your message. This JSON API is currently optimized for MarinaBook availability requests.",
    listSeparator: ", ",
    missingMany: (list) => `I still need ${list} to run the search.`,
    missingOne: (field) => `I still need ${field} to run the search.`,
    noAvailability:
      "I could not find any availability matching these criteria. You can adjust the dates, destination, or boat dimensions.",
    results: (result, arrival, departure) =>
      `I found availability at ${result.portName}, ${result.placeType}, from ${arrival} to ${departure}, for ${result.price} ${result.currency}. You can complete the booking with the button below.`,
    unsupported:
      "I can only help you search for a berth. Please specify a destination, arrival and departure dates, and your boat length.",
  },
  es: {
    errorDraftIgnored:
      "Guardo el calado en el contexto, pero no lo envío a MarinaBook para esta búsqueda.",
    errorGeneric:
      "La búsqueda de MarinaBook encontró un error en el servidor. Vuelva a intentarlo en unos instantes.",
    errorNotConfigured:
      "El servicio MarinaBook no está configurado en el servidor.",
    errorUnavailable:
      "El servicio MarinaBook no está disponible temporalmente. Vuelva a intentarlo en unos instantes.",
    general:
      "He recibido su mensaje. Esta API JSON está optimizada actualmente para las búsquedas de disponibilidad de MarinaBook.",
    listSeparator: ", ",
    missingMany: (list) => `Todavía me falta ${list} para iniciar la búsqueda.`,
    missingOne: (field) => `Me falta ${field} para iniciar la búsqueda.`,
    noAvailability:
      "No he encontrado disponibilidad que coincida con estos criterios. Puede modificar las fechas, el destino o las dimensiones del barco.",
    results: (result, arrival, departure) =>
      `He encontrado disponibilidad en ${result.portName}, plaza ${result.placeType}, del ${arrival} al ${departure}, por ${result.price} ${result.currency}. Puede finalizar la reserva con el botón de abajo.`,
    unsupported:
      "Solo puedo ayudarle a buscar un amarre. Indique un destino, las fechas de llegada y de salida, y la eslora de su barco.",
  },
  fr: {
    errorDraftIgnored:
      "Je garde le tirant d’eau dans le contexte, mais je ne l’envoie pas à MarinaBook pour cette recherche.",
    errorGeneric:
      "La recherche MarinaBook a rencontré une erreur côté serveur. Merci de réessayer dans quelques instants.",
    errorNotConfigured:
      "Le service MarinaBook n’est pas configuré côté serveur.",
    errorUnavailable:
      "Le service MarinaBook est temporairement indisponible. Merci de réessayer dans quelques instants.",
    general:
      "J’ai bien reçu votre message. Cette API JSON est actuellement optimisée pour les recherches de disponibilités MarinaBook.",
    listSeparator: ", ",
    missingMany: (list) =>
      `Il me manque encore ${list} pour lancer la recherche.`,
    missingOne: (field) => `Il me manque ${field} pour lancer la recherche.`,
    noAvailability:
      "Je n’ai pas trouvé de disponibilité correspondant à ces critères. Vous pouvez modifier les dates, la destination ou les dimensions du bateau.",
    results: (result, arrival, departure) =>
      `J’ai trouvé une disponibilité au ${result.portName}, place ${result.placeType}, du ${arrival} au ${departure}, pour ${result.price} ${result.currency}. Vous pouvez finaliser la réservation avec le bouton ci-dessous.`,
    unsupported:
      "Je peux uniquement vous aider à rechercher une place de port. Précisez une destination, des dates d’arrivée et de départ, ainsi que la longueur de votre bateau.",
  },
  it: {
    errorDraftIgnored:
      "Conservo il pescaggio nel contesto, ma non lo invio a MarinaBook per questa ricerca.",
    errorGeneric:
      "La ricerca MarinaBook ha riscontrato un errore lato server. Riprovi tra qualche istante.",
    errorNotConfigured: "Il servizio MarinaBook non è configurato sul server.",
    errorUnavailable:
      "Il servizio MarinaBook è temporaneamente non disponibile. Riprovi tra qualche istante.",
    general:
      "Ho ricevuto il suo messaggio. Questa API JSON è attualmente ottimizzata per le ricerche di disponibilità di MarinaBook.",
    listSeparator: ", ",
    missingMany: (list) => `Mi manca ancora ${list} per avviare la ricerca.`,
    missingOne: (field) => `Mi manca ${field} per avviare la ricerca.`,
    noAvailability:
      "Non ho trovato disponibilità corrispondenti a questi criteri. Può modificare le date, la destinazione o le dimensioni della barca.",
    results: (result, arrival, departure) =>
      `Ho trovato disponibilità presso ${result.portName}, posto ${result.placeType}, dal ${arrival} al ${departure}, per ${result.price} ${result.currency}. Può completare la prenotazione con il pulsante qui sotto.`,
    unsupported:
      "Posso aiutarla solo a cercare un posto barca. Indichi una destinazione, le date di arrivo e di partenza e la lunghezza della sua barca.",
  },
  pt: {
    errorDraftIgnored:
      "Mantenho o calado no contexto, mas não o envio à MarinaBook para esta pesquisa.",
    errorGeneric:
      "A pesquisa MarinaBook encontrou um erro no servidor. Tente novamente dentro de alguns instantes.",
    errorNotConfigured:
      "O serviço MarinaBook não está configurado no servidor.",
    errorUnavailable:
      "O serviço MarinaBook está temporariamente indisponível. Tente novamente dentro de alguns instantes.",
    general:
      "Recebi a sua mensagem. Esta API JSON está atualmente otimizada para as pesquisas de disponibilidade da MarinaBook.",
    listSeparator: ", ",
    missingMany: (list) => `Ainda me falta ${list} para iniciar a pesquisa.`,
    missingOne: (field) => `Falta-me ${field} para iniciar a pesquisa.`,
    noAvailability:
      "Não encontrei disponibilidade correspondente a estes critérios. Pode alterar as datas, o destino ou as dimensões do barco.",
    results: (result, arrival, departure) =>
      `Encontrei disponibilidade em ${result.portName}, lugar ${result.placeType}, de ${arrival} a ${departure}, por ${result.price} ${result.currency}. Pode finalizar a reserva com o botão abaixo.`,
    unsupported:
      "Só posso ajudá-lo a procurar um lugar de amarração. Indique um destino, as datas de chegada e de partida e o comprimento do seu barco.",
  },
};

const BCP47_LOCALES: Record<ReplyLanguage, string> = {
  ar: "ar",
  de: "de-DE",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  pt: "pt-PT",
};

export function formatDateForReply(date: string, lang: ReplyLanguage) {
  return new Intl.DateTimeFormat(BCP47_LOCALES[lang], {
    day: "numeric",
    month: "long",
    // Latin digits keep dates recognizable and "unchanged" across scripts.
    numberingSystem: "latn",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

export function listMissingFields(
  searchParams: SearchParamsForReply,
  lang: ReplyLanguage
) {
  return REQUIRED_FIELDS.filter(
    (field) => searchParams[field] === undefined
  ).map((field) => FIELD_LABELS[lang][field]);
}

export function createMissingInformationReply(
  missingFields: string[],
  lang: ReplyLanguage
) {
  const messages = MESSAGES[lang];
  if (missingFields.length === 1) {
    return messages.missingOne(missingFields[0]);
  }
  return messages.missingMany(missingFields.join(messages.listSeparator));
}

export function createGeneralReply(lang: ReplyLanguage) {
  return MESSAGES[lang].general;
}

export function createUnsupportedReply(lang: ReplyLanguage) {
  return MESSAGES[lang].unsupported;
}

export function createNoAvailabilityReply(lang: ReplyLanguage) {
  return MESSAGES[lang].noAvailability;
}

export function createAvailabilityResultsReply(
  results: ResultForReply[],
  searchParams: SearchParamsForReply,
  lang: ReplyLanguage
) {
  if (results.length === 0) {
    return createNoAvailabilityReply(lang);
  }

  const [firstResult] = results;
  const arrival = formatDateForReply(searchParams.arrivalDate as string, lang);
  const departure = formatDateForReply(
    searchParams.departureDate as string,
    lang
  );

  return MESSAGES[lang].results(firstResult, arrival, departure);
}

// Maps a low-level searchAvailability error into a localized, user-facing
// message. The matching is done on a diacritic-free, lowercase form so it works
// regardless of the backend's exact wording.
export function createAvailabilityErrorReply(
  error: string,
  lang: ReplyLanguage
) {
  const comparable = error
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const messages = MESSAGES[lang];

  const requiredFieldByToken: [RegExp, FieldName][] = [
    [/boatlength/, "boatLength"],
    [/destination/, "destination"],
    [/arrivaldate/, "arrivalDate"],
    [/departuredate/, "departureDate"],
    [/boatwidth/, "boatWidth"],
  ];

  if (comparable.includes("required")) {
    for (const [token, field] of requiredFieldByToken) {
      if (token.test(comparable)) {
        return messages.missingOne(FIELD_LABELS[lang][field]);
      }
    }
  }

  if (
    comparable.includes("unrecognized key") &&
    (comparable.includes("draft") || comparable.includes("boatdraft"))
  ) {
    return messages.errorDraftIgnored;
  }

  if (comparable.includes("not configured")) {
    return messages.errorNotConfigured;
  }

  if (
    comparable.includes("could not reach") ||
    comparable.includes("temporarily unavailable")
  ) {
    return messages.errorUnavailable;
  }

  return messages.errorGeneric;
}
