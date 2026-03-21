import { useEffect, useState } from 'react';
import { FolderOpen, Settings, MoreVertical, X, AlertTriangle, Plus, Trash2, Save } from 'lucide-react';
import { BudgetMeter } from '../components/BudgetMeter';
import { API_BASE_URL } from '../config';

interface ProjectData {
    id: string;
    name: string;
    daily_budget: number;
    total_spend_today: number;
    total_requests_today: number;
}

export default function Projects() {
    const [projects, setProjects] = useState<ProjectData[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal States
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [currentProject, setCurrentProject] = useState<ProjectData | null>(null);

    // Form States
    const [formData, setFormData] = useState({ name: '', daily_budget: 0 });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchProjects = () => {
        setLoading(true);
        fetch(`${API_BASE_URL}/api/projects`)
            .then(res => res.json())
            .then(resData => {
                setProjects(resData.data);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch projects:', err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchProjects();
    }, []);

    const handleOpenCreate = () => {
        setFormData({ name: '', daily_budget: 0 });
        setError(null);
        setIsCreateModalOpen(true);
    };

    const handleOpenEdit = (project: ProjectData) => {
        setCurrentProject(project);
        setFormData({ name: project.name, daily_budget: project.daily_budget });
        setError(null);
        setIsEditModalOpen(true);
    };

    const handleOpenDelete = (project: ProjectData) => {
        setCurrentProject(project);
        setError(null);
        setIsDeleteModalOpen(true);
    };

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Failed to create project');
            setIsCreateModalOpen(false);
            fetchProjects();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentProject) return;
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/projects/${currentProject.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update project');
            setIsEditModalOpen(false);
            fetchProjects();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteProject = async () => {
        if (!currentProject) return;
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/projects/${currentProject.id}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to delete project');
            setIsDeleteModalOpen(false);
            setIsEditModalOpen(false);
            fetchProjects();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Shared Modal Overlay Component
    const ModalOverlay = ({ children, onClose }: { children: React.ReactNode, onClose: () => void }) => (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="absolute inset-0" onClick={onClose} />
            <div className="relative bg-[#1A1A1A] border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                {children}
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="p-8 max-w-7xl mx-auto">
                <div className="animate-pulse h-10 w-48 bg-surfaceHighlight rounded mb-8"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="animate-pulse h-48 bg-surfaceHighlight rounded-xl w-full"></div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in relative">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                        <FolderOpen className="w-8 h-8 text-primary" />
                        Projects
                    </h1>
                    <p className="text-textMuted mt-2">Manage API keys and budget thresholds per project.</p>
                </div>
                <button 
                    onClick={handleOpenCreate}
                    className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors">
                    <Plus className="w-4 h-4" /> New Project
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((project) => (
                    <div key={project.id} className="card hover:border-border transition-colors group">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-lg font-bold text-white mb-1 group-hover:text-primary transition-colors">
                                    {project.name}
                                </h3>
                                <p className="text-xs text-textMuted font-mono bg-surfaceHighlight px-2 py-1 rounded inline-block">
                                    ID: {project.id}
                                </p>
                            </div>
                            <button 
                                onClick={() => handleOpenEdit(project)}
                                className="text-textMuted hover:text-white p-1 rounded hover:bg-surfaceHighlight transition-colors">
                                <MoreVertical className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <BudgetMeter spent={project.total_spend_today} budget={project.daily_budget} />

                            <div className="flex justify-between items-center pt-4 border-t border-border border-dashed">
                                <div className="text-sm">
                                    <p className="text-textMuted">Requests Today</p>
                                    <p className="font-semibold text-white mt-0.5">{project.total_requests_today.toLocaleString()}</p>
                                </div>
                                <button 
                                    onClick={() => handleOpenEdit(project)}
                                    className="text-textMuted hover:text-white flex items-center gap-1.5 text-sm font-medium transition-colors">
                                    <Settings className="w-4 h-4" /> Manage
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {projects.length === 0 && (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl">
                        <FolderOpen className="w-12 h-12 text-textMuted mb-4 opacity-50" />
                        <h3 className="text-lg font-medium text-white mb-2">No Projects Found</h3>
                        <p className="text-sm text-textMuted max-w-sm text-center">
                            You need at least one active project to track API costs. Create a default project to get started.
                        </p>
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {isCreateModalOpen && (
                <ModalOverlay onClose={() => setIsCreateModalOpen(false)}>
                    <div className="p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2"><Plus className="w-5 h-5 text-primary" /> Create Project</h2>
                            <button onClick={() => setIsCreateModalOpen(false)} className="text-textMuted hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        {error && (
                            <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-2 text-danger text-sm">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <p>{error}</p>
                            </div>
                        )}

                        <form onSubmit={handleCreateProject} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-1.5">Project Name</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-primary transition-colors"
                                    placeholder="e.g. Production Webapp"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-1.5">Daily Budget Limit (USD)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-primary transition-colors"
                                    placeholder="0 for unlimited"
                                    value={formData.daily_budget}
                                    onChange={e => setFormData({ ...formData, daily_budget: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="pt-4 flex justify-end gap-3 border-t border-border mt-6">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-sm font-medium text-textMuted hover:text-white transition-colors">
                                    Cancel
                                </button>
                                <button type="submit" disabled={isSubmitting || !formData.name} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                                    <Save className="w-4 h-4" /> {isSubmitting ? 'Creating...' : 'Create Project'}
                                </button>
                            </div>
                        </form>
                    </div>
                </ModalOverlay>
            )}

            {/* Edit Modal */}
            {isEditModalOpen && currentProject && (
                <ModalOverlay onClose={() => setIsEditModalOpen(false)}>
                    <div className="p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2"><Settings className="w-5 h-5 text-primary" /> Edit Project</h2>
                            <button onClick={() => setIsEditModalOpen(false)} className="text-textMuted hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        {error && (
                            <div className="mb-4 p-3 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-2 text-danger text-sm">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <p>{error}</p>
                            </div>
                        )}

                        <form onSubmit={handleUpdateProject} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-1.5">Project Name</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-primary transition-colors"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-1.5">Daily Budget Limit (USD)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-primary transition-colors"
                                    value={formData.daily_budget}
                                    onChange={e => setFormData({ ...formData, daily_budget: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="pt-4 flex justify-between items-center border-t border-border mt-6">
                                <button type="button" onClick={() => handleOpenDelete(currentProject)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 rounded-md transition-colors">
                                    <Trash2 className="w-4 h-4" /> Delete Project
                                </button>
                                <div className="flex gap-3">
                                    <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm font-medium text-textMuted hover:text-white transition-colors">
                                        Cancel
                                    </button>
                                    <button type="submit" disabled={isSubmitting || !formData.name} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                                        <Save className="w-4 h-4" /> {isSubmitting ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </ModalOverlay>
            )}

            {/* Delete Confirmation Modal */}
            {isDeleteModalOpen && currentProject && (
                <ModalOverlay onClose={() => setIsDeleteModalOpen(false)}>
                    <div className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-danger/10 rounded-full">
                                    <AlertTriangle className="w-6 h-6 text-danger" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">Delete Project?</h2>
                                </div>
                            </div>
                            <button onClick={() => setIsDeleteModalOpen(false)} className="text-textMuted hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <p className="text-textMuted text-sm mb-6 mt-2 pb-4 border-b border-border">
                            Are you sure you want to delete <strong className="text-white">{currentProject.name}</strong>? This action will permanently remove this project and all its associated data, including requests and alerts. This cannot be undone.
                        </p>

                        {error && (
                            <div className="mb-6 p-3 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-2 text-danger text-sm">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <p>{error}</p>
                            </div>
                        )}

                        <div className="flex justify-end gap-3">
                            <button onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 text-sm font-medium text-textMuted hover:text-white transition-colors">
                                Cancel
                            </button>
                            <button onClick={handleDeleteProject} disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 bg-danger hover:bg-danger/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                                <Trash2 className="w-4 h-4" /> {isSubmitting ? 'Deleting...' : 'Yes, Delete Project'}
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}
        </div>
    );
}
