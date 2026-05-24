'use client';

import { useState, useEffect, useRef } from 'react';

function getFuente(remitente) {
    return remitente?.startsWith('telegram:') ? 'telegram' : 'whatsapp';
}

function getNombreCorto(remitente) {
    if (remitente?.startsWith('telegram:')) {
        return `ID ${remitente.replace('telegram:', '').slice(0, 8)}...`;
    }
    return remitente?.replace('@c.us', '').replace('@s.whatsapp.net', '') || remitente;
}

const FILTROS = { TODOS: 'TODOS', WHATSAPP: 'WHATSAPP', TELEGRAM: 'TELEGRAM' };
const BOTONES_FILTRO = [
    { key: FILTROS.TODOS, label: 'Todos' },
    { key: FILTROS.TELEGRAM, label: 'Telegram' },
];

export default function AdminDashboard() {
    const [mensajes, setMensajes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [configError, setConfigError] = useState(null);
    const [filtro, setFiltro] = useState(FILTROS.TODOS);
    const [imagenAbierta, setImagenAbierta] = useState(null);
    const channelRef = useRef(null);

    useEffect(() => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey || supabaseUrl === 'TU_SUPABASE_URL') {
            setConfigError('Credenciales de Supabase no configuradas. Revisa el archivo .env.local');
            setLoading(false);
            return;
        }

        let cancelled = false;

        (async () => {
            const { createClient } = await import('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey);

            const { data, error } = await supabase
                .from('mensajes_wsp')
                .select('*')
                .order('fecha', { ascending: false });

            if (cancelled) return;

            if (error) {
                setError('No se pudieron cargar los mensajes.');
                setMensajes([]);
            } else {
                setMensajes(data);
            }
            setLoading(false);

            const channel = supabase
                .channel('mensajes-realtime')
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'mensajes_wsp' },
                    (payload) => {
                        setMensajes((prev) => [payload.new, ...prev]);
                    }
                )
                .subscribe();

            channelRef.current = channel;
        })();

        return () => {
            cancelled = true;
            if (channelRef.current) {
                channelRef.current.unsubscribe();
            }
        };
    }, []);

    const mensajesFiltrados = mensajes.filter((msg) => {
        if (filtro === FILTROS.TODOS) return true;
        return getFuente(msg.remitente) === filtro.toLowerCase();
    });

    if (configError) {
        return (
            <div className="container mx-auto p-4 max-w-4xl">
                <h1 className="text-3xl font-bold mb-6 text-center text-zinc-800">Dashboard de Sneakers</h1>
                <div className="text-center p-8 text-amber-600 bg-amber-50 rounded-xl border border-amber-200">{configError}</div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="container mx-auto p-4 max-w-4xl">
                <h1 className="text-3xl font-bold mb-6 text-center text-zinc-800">Dashboard de Sneakers</h1>
                <div className="text-center p-8 text-zinc-500">Cargando mensajes...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mx-auto p-4 max-w-4xl">
                <h1 className="text-3xl font-bold mb-6 text-center text-zinc-800">Dashboard de Sneakers</h1>
                <div className="text-center p-8 text-red-500">{error}</div>
            </div>
        );
    }

    const countTelegram = mensajes.filter(m => getFuente(m.remitente) === 'telegram').length;

    return (
        <>
            <div className="container mx-auto p-4 max-w-4xl">
                <h1 className="text-3xl font-bold mb-2 text-center text-zinc-800">Dashboard de Sneakers</h1>
                <p className="text-center text-zinc-400 text-sm mb-6">
                    {mensajes.length} registros — {countTelegram} Telegram
                </p>

                <div className="flex justify-center gap-2 mb-6">
                    {BOTONES_FILTRO.map((b) => (
                        <button
                            key={b.key}
                            onClick={() => setFiltro(b.key)}
                            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                                filtro === b.key ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                            }`}
                        >
                            {b.label}
                        </button>
                    ))}
                </div>

                {mensajesFiltrados.length === 0 ? (
                    <p className="text-center p-8 text-zinc-400">No hay mensajes registrados.</p>
                ) : (
                    <div className="space-y-4">
                        {mensajesFiltrados.map((msg) => {
                            const fuente = getFuente(msg.remitente);
                            return (
                                <div
                                    key={msg.id}
                                    className="border border-zinc-200 rounded-xl shadow-sm p-5 bg-white hover:shadow-md transition-shadow"
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                fuente === 'telegram' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                                            }`}>
                                                Telegram
                                            </span>
                                            <span className="text-sm text-zinc-500 font-medium">
                                                {getNombreCorto(msg.remitente)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="mb-3">
                                        <p className="text-zinc-800 text-base whitespace-pre-wrap break-words">
                                            {msg.contenido}
                                        </p>
                                        {msg.imagen_url && (
                                            <img
                                                src={msg.imagen_url}
                                                alt="Foto del sneaker"
                                                className="mt-3 max-h-64 w-auto rounded-lg object-cover cursor-pointer border border-zinc-200"
                                                onClick={() => setImagenAbierta(msg.imagen_url)}
                                            />
                                        )}
                                    </div>
                                    <div className="flex justify-end text-xs text-zinc-400">
                                        {new Date(msg.fecha).toLocaleString('es-ES', {
                                            year: 'numeric', month: '2-digit', day: '2-digit',
                                            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {imagenAbierta && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 cursor-pointer"
                    onClick={() => setImagenAbierta(null)}
                >
                    <img
                        src={imagenAbierta}
                        alt="Foto ampliada"
                        className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </>
    );
}
